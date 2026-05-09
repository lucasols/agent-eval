import { __LEGIT_CAST__ } from '@ls-stack/utils/saferTyping';
import { hc, type ClientResponse } from 'hono/client';
import type { SuccessStatusCode } from 'hono/utils/http-status';
import { Result, resultify } from 't-result';
import { z } from 'zod/v4';
import { apiBaseUrl } from '#src/utils/apiUrl';
// eslint-disable-next-line @ls-stack/no-relative-imports, no-restricted-syntax -- this is needed
import type { AppType } from '../../../server/src/app.ts';

export const apiClient = hc<AppType>(`${apiBaseUrl}/`);

const rpcErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

export class RpcResponseError extends Error {
  readonly status: number;
  readonly response: unknown;

  constructor(params: { status: number; message: string; response: unknown }) {
    super(params.message);
    this.name = 'RpcResponseError';
    this.status = params.status;
    this.response = params.response;
  }
}

type GetSuccessResponseJson<T extends ClientResponse<unknown, number, 'json'>> =
  T extends ClientResponse<infer R, SuccessStatusCode, 'json'> ? R : never;

function getErrorMessage(params: {
  status: number;
  response: unknown;
}): string {
  const parsed = rpcErrorResponseSchema.safeParse(params.response);
  if (parsed.success) return parsed.data.message ?? parsed.data.error;
  return `Server responded ${String(params.status)}`;
}

export async function getRpcResult<
  T extends ClientResponse<unknown, number, 'json'>,
>(
  res: Promise<T>,
): Promise<Result<GetSuccessResponseJson<T>, RpcResponseError>> {
  const responseResult = await resultify(res);

  if (responseResult.error) {
    return Result.err(
      new RpcResponseError({
        status: 0,
        message: responseResult.error.message,
        response: null,
      }),
    );
  }

  const bodyResult = await resultify(responseResult.value.json());
  const response = bodyResult.error ? null : bodyResult.value;

  if (responseResult.value.ok && !bodyResult.error) {
    return Result.ok(__LEGIT_CAST__<GetSuccessResponseJson<T>>(response));
  }

  return Result.err(
    new RpcResponseError({
      status: responseResult.value.status,
      message: bodyResult.error
        ? 'Server returned an invalid JSON response'
        : getErrorMessage({ status: responseResult.value.status, response }),
      response,
    }),
  );
}

export async function getRpcResultUnwrap<
  T extends ClientResponse<unknown, number, 'json'>,
>(res: Promise<T>): Promise<GetSuccessResponseJson<T>> {
  const result = await getRpcResult(res);
  if (result.error) throw result.error;
  return result.value;
}
