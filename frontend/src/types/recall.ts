/**
 * 召回测试相关类型定义
 */

/** 召回测试参数 */
export interface RecallTestParams {
  query: string;
  topK: number;
  scoreThreshold: number;
}

/** 召回结果项 */
export interface RecallResult {
  chunkId: string;
  fileName: string;
  location: string;
  score: number;
  content: string;
  imageUrl?: string;
}

/** 召回测试响应 */
export interface RecallTestResponse {
  results: RecallResult[];
  queryTime: number;
}
