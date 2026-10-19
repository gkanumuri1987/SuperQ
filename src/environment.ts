import { z } from "zod";
const secretName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const Account = z
  .object({
    role: z.string().min(1),
    username: z.string().optional(),
    passwordEnv: secretName.optional(),
    tokenEnv: secretName.optional(),
    totpSecretEnv: secretName.optional(),
  })
  .strict();
export const Environment = z
  .object({
    baseURL: z.url(),
    apiURL: z.url().optional(),
    urls: z.record(z.string(), z.url()).optional(),
    data: z.record(z.string(), z.unknown()).default({}),
    users: z.record(z.string(), Account).optional(),
    defaultUser: z.string().min(1).optional(),
    suiteData: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .optional(),
    testData: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .optional(),
    sso: z
      .object({
        startPath: z.string().min(1),
        successPath: z.string().min(1),
        successText: z.string().min(1),
        allowedOrigins: z.array(z.url()).max(20).default([]),
        maxAgeMinutes: z.number().int().min(1).max(480).default(60),
      })
      .strict()
      .optional(),
    login: z
      .object({
        path: z.string().min(1),
        usernameLabel: z.string().min(1),
        passwordLabel: z.string().min(1),
        submitButton: z.string().min(1),
        successPath: z.string().min(1),
        mfa: z
          .object({
            codeLabel: z.string().min(1),
            submitButton: z.string().min(1),
            digits: z.union([z.literal(6), z.literal(8)]).optional(),
            period: z.union([z.literal(30), z.literal(60)]).optional(),
            algorithm: z.enum(["sha1", "sha256", "sha512"]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Environment = z.infer<typeof Environment>;
