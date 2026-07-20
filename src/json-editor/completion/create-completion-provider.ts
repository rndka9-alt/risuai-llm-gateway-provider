import {
  ClientCapabilities,
  CompletionItemKind,
  getLanguageService,
  InsertTextFormat,
  TextDocument,
} from 'vscode-json-languageservice';
import type { CompletionItem, JSONSchema } from 'vscode-json-languageservice';
import type { JsonCompletion } from '../types';
import { resolveSnippet } from './resolve-snippet';

const DOCUMENT_URI = 'inmemory://json-editor/document.json';
const SCHEMA_URI = 'inmemory://json-editor/schema.json';

export interface CompletionProvider {
  completionsAt(text: string, offset: number): Promise<JsonCompletion[]>;
}

/** vscode-json-languageservice를 감싸 LSP 좌표계(line/character)를
 *  코어 좌표계(offset)로 변환해서 노출한다 */
export function createCompletionProvider(jsonSchema: JSONSchema): CompletionProvider {
  const languageService = getLanguageService({
    clientCapabilities: ClientCapabilities.LATEST,
  });
  languageService.configure({
    allowComments: false,
    schemas: [{ uri: SCHEMA_URI, fileMatch: ['*.json'], schema: jsonSchema }],
  });

  let documentVersion = 0;

  return {
    async completionsAt(text, offset) {
      documentVersion += 1;
      const document = TextDocument.create(DOCUMENT_URI, 'json', documentVersion, text);
      const jsonDocument = languageService.parseJSONDocument(document);
      const completionList = await languageService.doComplete(
        document,
        document.positionAt(offset),
        jsonDocument,
      );
      if (!completionList) return [];
      return [...completionList.items]
        .sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label))
        .map((item) => toJsonCompletion(item, document, offset));
    },
  };
}

function toJsonCompletion(
  item: CompletionItem,
  document: TextDocument,
  fallbackOffset: number,
): JsonCompletion {
  let replaceStart = fallbackOffset;
  let replaceEnd = fallbackOffset;
  let rawInsertText = item.insertText ?? item.label;
  if (item.textEdit) {
    const range = 'range' in item.textEdit ? item.textEdit.range : item.textEdit.replace;
    replaceStart = document.offsetAt(range.start);
    replaceEnd = document.offsetAt(range.end);
    rawInsertText = item.textEdit.newText;
  }

  const { text, cursorStart, cursorEnd } =
    item.insertTextFormat === InsertTextFormat.Snippet
      ? resolveSnippet(rawInsertText)
      : { text: rawInsertText, cursorStart: rawInsertText.length, cursorEnd: rawInsertText.length };

  return {
    label: item.label,
    kind: item.kind === CompletionItemKind.Property ? 'property' : 'value',
    documentation: documentationText(item),
    filterText: item.filterText ?? item.label,
    replaceStart,
    replaceEnd,
    insertText: text,
    cursorStart,
    cursorEnd,
  };
}

function documentationText(item: CompletionItem): string | undefined {
  if (typeof item.documentation === 'string') return item.documentation;
  return item.documentation?.value;
}
