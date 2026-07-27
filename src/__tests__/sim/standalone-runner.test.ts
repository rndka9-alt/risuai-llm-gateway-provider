import { describe, expect, it } from 'vitest';
import { runStandaloneSimulation } from '../../sim-runner';

const validInput = {
  cacheBackendPresets: ['calibrated'],
  costModel: {
    readTokenSavingsRate: 0.9,
    writeTokenPremiumRate: 0.25,
  },
  policies: ['production', 'no-cache'],
  scenarios: [
    {
      id: 'standalone-smoke',
      label: 'standalone smoke',
      requests: [
        {
          elapsedMinutes: 0,
          messages: [{ content: 'Standalone request.', role: 'user' }],
        },
      ],
    },
  ],
  schemaVersion: 1,
};

describe('standalone simulation runner', () => {
  it('버전된 JSON 입력으로 policy matrix를 실행하고 global을 복구한다', async () => {
    const previousRisuaiDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'risuai');

    const report = await runStandaloneSimulation(validInput);

    expect(report.schemaVersion).toBe(1);
    expect(report.results.map((result) => result.policyName)).toEqual(['production', 'no-cache']);
    expect(report.results[0].requests[0]).not.toHaveProperty('requestBody');
    expect(Object.getOwnPropertyDescriptor(globalThis, 'risuai')).toEqual(previousRisuaiDescriptor);
  });

  it('중복 policy를 묵음 실행하지 않는다', async () => {
    await expect(
      runStandaloneSimulation({
        ...validInput,
        policies: ['production', 'production'],
      }),
    ).rejects.toThrow('policies must not contain duplicates.');
  });
});
