import * as z from 'zod';

// GPT-5.6(sol/terra/luna) × llmgateway.io 한정 chat completions 요청 body 스키마.
// json-editor의 자동완성·검증 세트로 쓰인다 (toJSONSchema → 자동완성, safeParse → 진단).
//
// Gateway의 느슨한 ingress(알 수 없는 키를 400 없이 제거)를 복제하지 않고, 실제로 의미가
// 있는 요청만 허용한다 — 조용히 유실되는 필드(max_completion_tokens, stream_options 등)와
// no-op(n:1, routing 등)은 의도적으로 제외. 근거: llmgateway 공개 계약·모델 카탈로그와
// gpt-5.6-sol 실측(reasoning_effort minimal→400, max→200). 조사 2026-07-20.
//
// 플러그인이 소유·자동 부여하는 필드(stream, prompt_cache_key, prompt_cache_options)도
// 세트에서 제외한다 — stream은 응답 파서 모드와, prompt_cache_*는 캐시 planner 상태와
// 결합되어 있어 커스텀 body로 덮으면 탈동기된다. 에디터가 '정의되지 않은 키' 워닝으로
// 귀띔하되 병합 자체는 막지 않는다 (messages는 breakpoint 실험을 위해 세트에 남긴다).

const JsonObjectSchema = z.record(z.string(), z.json());

const PromptCacheBreakpointSchema = z.strictObject({
  mode: z.enum(['explicit']),
});

const TextPartSchema = z.strictObject({
  type: z.enum(['text']),
  text: z.string(),
  prompt_cache_breakpoint: PromptCacheBreakpointSchema.optional(),
});

const ImagePartSchema = z.strictObject({
  type: z.enum(['image_url']),
  image_url: z.strictObject({
    url: z.string().min(1),
    // OpenAI 모델 자체와 달리 Gateway ingress enum에는 "original"이 없다 (보내면 400)
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
  prompt_cache_breakpoint: PromptCacheBreakpointSchema.optional(),
});

const TextContentSchema = z.union([z.string(), z.array(TextPartSchema).min(1)]);

// GPT-5.6 입력 capability는 text/image뿐 — input_audio·file part는 Gateway 400
const UserContentSchema = z.union([
  z.string(),
  z.array(z.union([TextPartSchema, ImagePartSchema])).min(1),
]);

const FunctionCallSchema = z.strictObject({
  name: z.string().min(1).max(64),
  arguments: z.string(),
});

const AssistantToolCallSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(['function']),
  function: FunctionCallSchema,
});

const DeveloperMessageSchema = z.strictObject({
  role: z.enum(['developer']),
  content: TextContentSchema,
  name: z.string().optional(),
});

const SystemMessageSchema = z.strictObject({
  role: z.enum(['system']),
  content: TextContentSchema,
  name: z.string().optional(),
});

const UserMessageSchema = z.strictObject({
  role: z.enum(['user']),
  content: UserContentSchema,
  name: z.string().optional(),
});

const AssistantMessageSchema = z
  .strictObject({
    role: z.enum(['assistant']),
    content: TextContentSchema.nullable().optional(),
    name: z.string().optional(),
    tool_calls: z.array(AssistantToolCallSchema).min(1).optional(),
  })
  .superRefine((message, context) => {
    if (message.content == null && !message.tool_calls?.length) {
      context.addIssue({
        code: 'custom',
        message: 'assistant 메시지는 content 또는 tool_calls가 필요해요',
      });
    }
  });

const ToolMessageSchema = z.strictObject({
  role: z.enum(['tool']),
  content: TextContentSchema,
  tool_call_id: z.string().min(1),
});

const MessageSchema = z.union([
  DeveloperMessageSchema,
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

const FunctionToolSchema = z.strictObject({
  type: z.enum(['function']),
  function: z.strictObject({
    name: z.string().min(1).max(64),
    description: z.string().optional(),
    parameters: JsonObjectSchema.optional(),
  }),
});

// Gateway 네이티브 web-search 도구. max_uses·domain 필터는 OpenAI 변환에서 제거되므로 제외
const WebSearchToolSchema = z.strictObject({
  type: z.enum(['web_search']),
  user_location: z
    .strictObject({
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  search_context_size: z.enum(['low', 'medium', 'high']).optional(),
});

const ToolSchema = z.union([FunctionToolSchema, WebSearchToolSchema]);

const ToolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.strictObject({
    type: z.enum(['function']),
    function: z.strictObject({
      name: z.string().min(1).max(64),
    }),
  }),
]);

const ResponseFormatSchema = z.union([
  z.strictObject({
    type: z.enum(['text']),
  }),
  z.strictObject({
    type: z.enum(['json_object']),
  }),
  z.strictObject({
    type: z.enum(['json_schema']),
    json_schema: z.strictObject({
      name: z.string().min(1).max(64),
      description: z.string().optional(),
      // Gateway 검증에서 schema는 필수 (OpenAI 표준과 달리 생략하면 400)
      schema: JsonObjectSchema,
      strict: z.boolean().optional(),
    }),
  }),
]);

// "minimal"은 GPT-5.6 upstream에서 400으로 거절된다 (gpt-5.6-sol 실측) — 의도적으로 제외
const ReasoningEffortSchema = z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

const GatewayPluginSchema = z.strictObject({
  id: z.enum(['response-healing']),
});

// .describe()는 toJSONSchema를 타고 property description이 되어, json-editor 자동완성 문서로 노출된다.
// 이 스키마는 '커스텀 body 조각' 편집용이다 — model·messages 같은 필수값은 플러그인이 채우므로
// .partial()로 최상위 필드를 전부 optional로 낮춘다. 미정의 키·값 검증은 그대로 유지된다.
export const gpt56ChatCompletionsRequestSchema = z
  .strictObject({
    // options.ts의 MODEL_OPTIONS와 동기화 (enum 자동완성을 위해 리터럴로 유지)
    model: z
      .enum(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
      .describe('llmgateway.io GPT-5.6 모델 ID'),

    messages: z
      .array(MessageSchema)
      .min(1)
      .describe('대화 메시지. GPT-5.6 입력은 text/image만 지원해요'),

    // Gateway가 받는 이름은 max_tokens (max_completion_tokens는 ingress에서 조용히 제거).
    // 단 실측(2026-07-23, probe-request-fields)상 hosted는 범위(1~128000)만 검증하고
    // upstream 출력 제한으로 전달하지 않는 validate-only no-op 상태였다
    max_tokens: z
      .number()
      .int()
      .min(1)
      .max(128_000)
      .describe(
        '최대 출력 토큰 (1~128000). 주의: 실측상 hosted Gateway가 범위만 검증하고 실제 출력 제한으로는 전달하지 않았어요 (2026-07-23)',
      )
      .optional(),

    temperature: z
      .number()
      .min(0)
      .max(2)
      .describe('샘플링 온도 (0~2, 기본 1). top_p와 둘 중 하나만 조절 권장')
      .optional(),
    top_p: z.number().min(0).max(1).describe('누적 확률 컷 (0~1, 기본 1)').optional(),
    frequency_penalty: z
      .number()
      .min(-2)
      .max(2)
      .describe('반복 빈도 페널티 (-2~2, 기본 0)')
      .optional(),
    presence_penalty: z
      .number()
      .min(-2)
      .max(2)
      .describe('신규 주제 유도 페널티 (-2~2, 기본 0)')
      .optional(),

    reasoning_effort: ReasoningEffortSchema.describe(
      '추론 강도 (기본 medium). minimal은 GPT-5.6 upstream이 400으로 거절해요',
    ).optional(),
    reasoning: z
      .strictObject({
        // reasoning.max_tokens는 GPT-5.6 mapping에 없어 Gateway 400 — 제외
        effort: ReasoningEffortSchema,
      })
      .describe('reasoning_effort의 대체 표현 — 둘을 동시에 보내면 400이에요')
      .optional(),

    verbosity: z
      .enum(['low', 'medium', 'high'])
      .describe('응답 길이 성향 (기본 medium)')
      .optional(),
    response_format: ResponseFormatSchema.describe(
      '출력 형식. json_schema는 Structured Outputs (schema 필수)',
    ).optional(),

    tools: z
      .array(ToolSchema)
      .min(1)
      .max(128)
      .describe('function 도구 또는 Gateway 네이티브 web_search 도구')
      .optional(),
    tool_choice: ToolChoiceSchema.describe('도구 선택 전략 (기본: tools 있으면 auto)').optional(),
    web_search: z.boolean().describe('true면 Gateway가 web-search 도구로 변환해요').optional(),

    // OpenAI의 "scale"은 Gateway 계약에 없다
    service_tier: z
      .enum(['auto', 'default', 'flex', 'priority'])
      .describe('처리 티어. flex=저가 best-effort, priority=우선 처리(높은 배율)')
      .optional(),

    // OpenAI 모델 입력이 아니라 Gateway sticky-routing 식별자로 사용된다
    user: z
      .string()
      .min(1)
      .describe('Gateway sticky-routing 식별자 (OpenAI로는 전달되지 않아요)')
      .optional(),

    plugins: z
      .array(GatewayPluginSchema)
      .max(1)
      .describe('response-healing: JSON 응답 복구 플러그인 (JSON response_format 필요)')
      .optional(),
  })
  .partial()
  .superRefine((body, context) => {
    if (body.reasoning_effort && body.reasoning) {
      context.addIssue({
        code: 'custom',
        path: ['reasoning'],
        message: 'reasoning_effort와 reasoning.effort는 동시에 사용할 수 없어요 (Gateway 400)',
      });
    }

    const functionNames = new Set(
      body.tools
        ?.filter((tool): tool is z.infer<typeof FunctionToolSchema> => tool.type === 'function')
        .map((tool) => tool.function.name),
    );

    if (
      body.tool_choice &&
      typeof body.tool_choice !== 'string' &&
      !functionNames.has(body.tool_choice.function.name)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tool_choice'],
        message: 'tool_choice가 지정한 function이 tools에 없어요',
      });
    }

    const webSearchToolCount = body.tools?.filter((tool) => tool.type === 'web_search').length ?? 0;
    if (webSearchToolCount > 1) {
      context.addIssue({
        code: 'custom',
        path: ['tools'],
        message: 'web_search tool은 하나만 지정할 수 있어요',
      });
    }

    let breakpointCount = 0;
    for (const message of body.messages ?? []) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.prompt_cache_breakpoint) breakpointCount += 1;
      }
    }

    if (breakpointCount > 4) {
      context.addIssue({
        code: 'custom',
        path: ['messages'],
        message: 'prompt_cache_breakpoint는 최대 4개예요',
      });
    }

    // breakpoint에 필요한 explicit 모드는 검증하지 않는다 — 조각(draft) 단계에서는
    // 플러그인 캐시 설정이 prompt_cache_options를 채우는지 알 수 없다

    if (body.plugins?.length && (!body.response_format || body.response_format.type === 'text')) {
      context.addIssue({
        code: 'custom',
        path: ['plugins'],
        message: 'response-healing은 JSON response_format과 함께 사용해야 해요',
      });
    }
  });

export type Gpt56ChatCompletionsRequest = z.infer<typeof gpt56ChatCompletionsRequestSchema>;

/** 의도적으로 세트에서 뺀 키의 에디터 안내 문구 — "정의되지 않은 키" 대신 대체 수단을 알려준다 */
export const gpt56ExcludedKeyMessages: Record<string, string> = {
  stream: '스트리밍 여부는 플러그인의 응답 방식 설정에서 조절해 주세요',
  stream_options: '스트리밍 usage 옵션은 플러그인이 자동으로 부여해요',
  prompt_cache_key: '캐시 키는 플러그인의 프롬프트 캐시 설정이 자동 관리해요',
  prompt_cache_options: '캐시 모드·TTL은 플러그인의 프롬프트 캐시 설정이 자동 관리해요',
  max_completion_tokens: 'Gateway에서 사용할 수 없는 이름이에요. max_tokens를 사용해 주세요',
};
