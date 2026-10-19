import { z } from "zod";
const secretName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const Account = z
  .object({
    role: z.string().min(1),
    username: z.string().optional(),
    passwordEnv: secretName.optional(),
    tokenEnv: secretName.optional(),
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
    login: z
      .object({
        path: z.string().min(1),
        usernameLabel: z.string().min(1),
        passwordLabel: z.string().min(1),
        submitButton: z.string().min(1),
        successPath: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Environment = z.infer<typeof Environment>;
