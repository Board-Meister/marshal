import type { RegisterConfig } from "index";

export function generateConfig({
  source,
  name,
  namespace = 'testsuite',
  version = '1.0.0',
  type = 'module',
}: {
  source: string|object;
  name: string;
  namespace?: string;
  version?: string;
  type?: 'module'|'scope';
}): RegisterConfig {
  return {
    entry: {
      source: typeof source == 'string'? '/__spec__/modules/' + source : source,
      name,
      namespace,
      version,
    },
    type,
  }
}