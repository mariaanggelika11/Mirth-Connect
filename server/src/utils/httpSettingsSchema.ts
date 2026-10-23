import { z } from 'zod';
import { httpSettingsError, type HttpSettings } from './httpSettings.js';
export const httpSettingsSchema = z.custom<HttpSettings>((value) => !httpSettingsError(value), {
  message: 'Check HTTP method, authentication and unique unmanaged header slots.',
});
