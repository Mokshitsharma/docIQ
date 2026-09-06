/**
 * LLMProvider interface.
 *
 *   complete({ system: string, prompt: string, temperature?: number,
 *              maxTokens?: number, json?: boolean }): Promise<string>
 *   readonly name: string
 */
export class LLMProvider {
  get name() {
    return 'base';
  }

  // eslint-disable-next-line no-unused-vars
  async complete(opts) {
    throw new Error('LLMProvider.complete not implemented');
  }
}
