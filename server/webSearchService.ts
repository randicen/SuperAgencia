// Web search service is currently being refactored to be LLM-driven.
// Stubbed out to allow server compilation.

export type SearchSource = {
  title: string;
  url: string;
  snippet?: string;
};

export const searchExternalInfo = async (): Promise<{ sources: SearchSource[] }> => {
  return { sources: [] };
};

export const buildSourcesContext = (sources: SearchSource[]): string => {
  return '';
};
