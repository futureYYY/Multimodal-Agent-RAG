/**
 * 召回测试相关 API
 */

import request from './request';
import type {
  RecallTestParams,
  RecallTestResponse,
  ApiResponse,
} from '@/types';

/** 执行召回测试 */
export const executeRecallTest = (
  kbId: string,
  params: RecallTestParams
): Promise<ApiResponse<RecallTestResponse>> => {
  return request.post(`/knowledge-bases/${kbId}/recall`, params);
};
