export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

export function formatErrorResponse(
  message: string,
  type: string,
  param?: string,
  code?: string,
): OpenAIErrorResponse {
  return {
    error: {
      message,
      type,
      param: param ?? null,
      code: code ?? null,
    },
  };
}
