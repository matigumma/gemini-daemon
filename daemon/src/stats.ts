const requestCounts = new Map<string, number>();

export function recordRequest(model: string): void {
  requestCounts.set(model, (requestCounts.get(model) ?? 0) + 1);
}

export function getStats(): { requests_by_model: Record<string, number> } {
  const requests_by_model: Record<string, number> = {};
  for (const [model, count] of requestCounts) {
    requests_by_model[model] = count;
  }
  return { requests_by_model };
}
