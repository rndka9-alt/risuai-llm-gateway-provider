import { z } from 'zod';

export const argumentBackupSchema = z.record(z.string());

export type ArgumentBackup = z.infer<typeof argumentBackupSchema>;
