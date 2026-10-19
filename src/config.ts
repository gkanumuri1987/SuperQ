import { z } from 'zod';
const engine=z.enum(['chromium','firefox','webkit','chrome','edge']);
const common={browser:engine.default('chromium'),viewport:z.object({width:z.number().int().min(320).max(7680),height:z.number().int().min(240).max(4320)}).strict().default({width:1280,height:720}),locale:z.string().default('en-US'),timezoneId:z.string().default('UTC')};
export const BrowserProfile=z.discriminatedUnion('provider',[
  z.object({provider:z.literal('local'),...common,headless:z.boolean().default(true)}).strict(),
  z.object({provider:z.literal('browserstack'),...common,os:z.string().min(1),osVersion:z.string().min(1),browserVersion:z.string().default('latest'),build:z.string().default('SuperQ'),project:z.string().default('SuperQ'),localIdentifier:z.string().min(1).optional(),maxSessions:z.number().int().min(1).max(64).default(1),video:z.boolean().default(false),networkLogs:z.boolean().default(false)}).strict(),
  z.object({provider:z.literal('lambdatest'),...common,platform:z.string().min(1),browserVersion:z.string().default('latest'),build:z.string().default('SuperQ'),project:z.string().default('SuperQ'),tunnelName:z.string().min(1).optional(),maxSessions:z.number().int().min(1).max(64).default(1),video:z.boolean().default(false),networkLogs:z.boolean().default(false)}).strict(),
]);
export type BrowserProfile=z.infer<typeof BrowserProfile>;
export const Execution=z.object({user:z.string().min(1).optional(),stepTimeoutMs:z.number().int().min(10).max(600000).default(30000),workers:z.number().int().min(1).max(64).default(1),retries:z.number().int().min(0).max(3).default(0),maxFailures:z.number().int().min(0).default(0),failOnFlaky:z.boolean().default(true),includeTags:z.array(z.string()).default([]),excludeTags:z.array(z.string()).default([]),testIds:z.array(z.string()).default([]),shard:z.object({index:z.number().int().min(1),total:z.number().int().min(1).max(256)}).strict().refine(x=>x.index<=x.total,'Shard index exceeds total').optional()}).strict();
export type Execution=z.infer<typeof Execution>;
export const Reporting=z.object({formats:z.array(z.enum(['json','html','junit','markdown'])).min(1).default(['json','html','junit']),minimumAutomation:z.number().min(0).max(1).default(0),minimumProven:z.number().min(0).max(1).default(0),failOnCriticalGaps:z.boolean().default(false)}).strict();
export type Reporting=z.infer<typeof Reporting>;
