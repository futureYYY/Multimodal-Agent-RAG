/**
 * 对话相关 API
 */

import request from './request';
import type {
  RewriteRequest,
  RewriteResponse,
  ChatRequest,
  SSEEventType,
  AgentThoughtData,
  RagResultData,
  AnswerChunkData,
  DoneData,
  ApiResponse,
} from '@/types';

/** 问题改写 */
export const rewriteQuery = (data: RewriteRequest): Promise<ApiResponse<RewriteResponse>> => {
  return request.post('/chat/rewrite', data);
};

/** SSE 事件处理器类型 */
export interface SSEEventHandlers {
  onAgentThought?: (data: AgentThoughtData) => void;
  onRagResult?: (data: RagResultData) => void;
  onAnswerChunk?: (data: AnswerChunkData) => void;
  onDone?: (data: DoneData) => void;
  onError?: (error: Error) => void;
}

/** 创建 SSE 对话连接 */
export const createChatStream = (
  data: ChatRequest,
  handlers: SSEEventHandlers
): { abort: () => void } => {
  const controller = new AbortController();

  fetch('/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            const eventType = line.slice(6).trim() as SSEEventType;
            continue;
          }

          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const eventData = JSON.parse(dataStr);

              // 根据数据结构判断事件类型
              if ('step' in eventData) {
                handlers.onAgentThought?.(eventData as AgentThoughtData);
              } else if ('citations' in eventData) {
                handlers.onRagResult?.(eventData as RagResultData);
              } else if ('content' in eventData && typeof eventData.content === 'string') {
                handlers.onAnswerChunk?.(eventData as AnswerChunkData);
              } else if ('usage' in eventData || Object.keys(eventData).length === 0) {
                handlers.onDone?.(eventData as DoneData);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        handlers.onError?.(error);
      }
    });

  return {
    abort: () => controller.abort(),
  };
};
