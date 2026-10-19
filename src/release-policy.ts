import { z } from 'zod';
export const Revision=z.string().regex(/^[a-f0-9]{40}$/i,'Expected full Git commit SHA');
export const ArtifactDigest=z.string().regex(/^sha256:[a-f0-9]{64}$/i,'Expected immutable sha256 artifact digest');
export const ReleasePolicy=z.object({
  environment:z.string().min(1),
  requiredSuites:z.array(z.string().min(1)).min(1),requiredProfiles:z.array(z.string().min(1)).min(1),
  maxAgeHours:z.number().positive().max(168).default(24),minimumAutomation:z.number().min(0).max(1).default(1),minimumProven:z.number().min(0).max(1).default(1),
  requiredChecks:z.array(z.string().min(1)).min(1).default(['security','performance','rollback','observability']),
  requiredApprovalRoles:z.array(z.string().min(1)).min(2).default(['qe','release-owner']),
}).strict();
export type ReleasePolicy=z.infer<typeof ReleasePolicy>;
export const PromotionManifest=z.object({applicationRevision:Revision,artifactDigest:ArtifactDigest,
  reports:z.array(z.string().min(1)).min(1),
  checks:z.array(z.object({id:z.string().min(1),status:z.enum(['passed','failed','pending']),applicationRevision:Revision,artifactDigest:ArtifactDigest,evidence:z.url(),checkedAt:z.iso.datetime()}).strict()),
  approvals:z.array(z.object({reviewer:z.string().min(1),role:z.string().min(1),decision:z.enum(['approved','rejected']),applicationRevision:Revision,artifactDigest:ArtifactDigest,at:z.iso.datetime()}).strict()),
}).strict();
export type PromotionManifest=z.infer<typeof PromotionManifest>;
