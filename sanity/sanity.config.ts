import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';

import { schemaTypes } from './schemas/index.ts';

// The project ID and dataset come from the environment (`sanity/.env`, never committed): see README.md.
export default defineConfig({
  name: 'default',
  title: 'G.A.W.Digital',
  projectId: process.env.SANITY_STUDIO_PROJECT_ID ?? '',
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',
  plugins: [structureTool()],
  schema: { types: schemaTypes },
});
