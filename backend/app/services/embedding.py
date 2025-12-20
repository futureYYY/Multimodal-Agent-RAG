"""
Embedding 服务
"""

import httpx
from typing import List
import base64
import os

from app.core.config import get_settings

settings = get_settings()


class EmbeddingService:
    """Embedding 服务"""

    def __init__(self, base_url: str = None, api_key: str = None, model: str = None):
        self.base_url = base_url or settings.EMBEDDING_BASE_URL
        self.api_key = api_key or settings.EMBEDDING_API_KEY
        self.model = model or settings.EMBEDDING_MODEL

    async def embed_query(self, text: str, model_id: str = None) -> List[float]:
        """获取文本的向量表示"""
        embeddings = await self._embed([text], model_id)
        return embeddings[0] if embeddings else []

    async def embed_documents(self, texts: List[str], model_id: str = None) -> List[List[float]]:
        """批量获取文本的向量表示"""
        return await self._embed(texts, model_id)

    async def _embed(self, texts: List[str], model_id: str = None) -> List[List[float]]:
        """调用 Embedding API"""
        target_model = model_id or self.model
        
        # 针对 Doubao 模型 (Volcengine) 的特殊处理
        # 1. 识别：通过模型名称或 URL 特征 (如 ark.cn-beijing.volces.com)
        is_doubao = "doubao" in target_model.lower() or "volces.com" in (self.base_url or "")
        
        if is_doubao:
            return await self._embed_doubao(texts, target_model)

        url = f"{self.base_url}/embeddings"
        
        # 打印调试信息
        print(f"DEBUG_EMBED: Requesting {url}")
        print(f"DEBUG_EMBED: Model: {target_model}")
        print(f"DEBUG_EMBED: Text Count: {len(texts)}")
        if self.api_key:
            masked_key = self.api_key[:6] + "***" + self.api_key[-4:] if len(self.api_key) > 10 else "***"
            print(f"DEBUG_EMBED: API Key: {masked_key}")
        else:
             print("DEBUG_EMBED: API Key: None")

        try:
            # 增加超时时间，并关闭 verify
            async with httpx.AsyncClient(timeout=60.0, verify=False) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": target_model,
                        "input": texts,
                    },
                )

                if response.status_code != 200:
                    print(f"DEBUG_EMBED: Error Status: {response.status_code}")
                    print(f"DEBUG_EMBED: Error Body: {response.text}")
                    # 如果是 404，可能是路径不对，尝试一下 doubao 逻辑（作为 fallback）
                    if response.status_code == 404 and "volces" in (self.base_url or ""):
                         print("DEBUG_EMBED: 404 detected, retrying with Doubao format...")
                         return await self._embed_doubao(texts, target_model)
                    
                    raise Exception(f"Embedding API 错误: {response.text}")

                result = response.json()
                # 按 index 排序确保顺序正确
                embeddings = sorted(result["data"], key=lambda x: x["index"])
                return [e["embedding"] for e in embeddings]

        except Exception as e:
            print(f"DEBUG_EMBED: Exception: {e}")
            raise

    async def _embed_doubao(self, texts: List[str], model_id: str) -> List[List[float]]:
        """调用 Doubao (Volcengine) Embedding API"""
        # 官方示例 URL 是完整的，不需要加 /embeddings 后缀
        # 如果 base_url 已经包含了 /embeddings/multimodal，则直接使用
        url = self.base_url
        
        # 严格检查 URL 是否为完整的 endpoint
        if "volces.com" in url and not url.endswith("/embeddings/multimodal"):
             # 如果用户只填了 base (e.g., https://ark.cn-beijing.volces.com/api/v3)，则补全
             url = f"{url.rstrip('/')}/embeddings/multimodal"
        
        print(f"DEBUG_EMBED_DOUBAO: Requesting {url}")
        
        embeddings = []
        
        # 使用 requests 替代 httpx 以避免 InvalidURL: URL too long 问题
        # 这是一个临时的同步调用，运行在 Celery 线程中是可以接受的
        import requests
        
        for text in texts:
            try:
                # 构造 Doubao 格式 input
                # 检查 text 是否包含图片占位符 [图片: xxx]
                input_data = []
                
                if text.startswith("[图片: ") and text.endswith("]"):
                     # 提取图片路径
                     image_path_str = text[5:-1]
                     
                     # 构造完整路径 (假设图片存储在 settings.IMAGE_DIR)
                     # image_path_str 可能是相对路径，也可能包含文件名
                     # 如果是 chunk 里的路径，通常是 uuid_page_idx.png
                     full_image_path = os.path.join(settings.IMAGE_DIR, image_path_str)
                     
                     if os.path.exists(full_image_path):
                         try:
                             with open(full_image_path, "rb") as image_file:
                                 encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                                 
                                 # 获取扩展名以确定 mime type
                                 ext = os.path.splitext(image_path_str)[1].lower().replace('.', '')
                                 if ext == 'jpg': ext = 'jpeg'
                                 # 默认 png
                                 if not ext: ext = 'png'
                                 
                                 data_uri = f"data:image/{ext};base64,{encoded_string}"
                                 
                                 input_data.append({
                                     "type": "image_url", 
                                     "image_url": {
                                         "url": data_uri
                                     }
                                 })
                         except Exception as img_err:
                             print(f"DEBUG_EMBED_DOUBAO: Image processing failed: {img_err}")
                             # Fallback to text if image fails
                             input_data.append({"type": "text", "text": text})
                     else:
                         print(f"DEBUG_EMBED_DOUBAO: Image not found at {full_image_path}")
                         # 尝试在 static/images 下查找 (如果是相对路径)
                         # 但 settings.IMAGE_DIR 应该是绝对路径或者相对于 cwd 的路径
                         input_data.append({"type": "text", "text": text})
                else:
                     # 确保 text 不为空，如果为空或者只是空白字符，API 可能会报错
                     # 如果是空字符串，替换为占位符或者跳过？
                     # 根据报错 MissingParameter, input[0].text，说明传了空字符串
                     clean_text = text.strip()
                     if not clean_text:
                         clean_text = " " # 使用一个空格代替空文本，或者更有意义的占位符 "empty content"
                     
                     input_data.append({"type": "text", "text": clean_text})

                payload = {
                    "model": model_id,
                    "input": input_data
                }
                
                # 打印调试信息：Payload (脱敏处理)
                import copy
                debug_payload = copy.deepcopy(payload)
                if "input" in debug_payload:
                    debug_input = []
                    for item in debug_payload["input"]:
                        if item.get("type") == "image_url":
                            url_val = item.get("image_url", {}).get("url", "")
                            if len(url_val) > 50:
                                debug_input.append({
                                    "type": "image_url",
                                    "image_url": {"url": url_val[:50] + "...(truncated)"}
                                })
                            else:
                                debug_input.append(item)
                        else:
                            debug_input.append(item)
                    debug_payload["input"] = debug_input
                print(f"DEBUG_EMBED_DOUBAO: Payload: {debug_payload}")

                # 使用 requests.post (同步)
                response = requests.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=60.0,
                    verify=False
                )

                if response.status_code != 200:
                    print(f"DEBUG_EMBED_DOUBAO: Error Status: {response.status_code}")
                    print(f"DEBUG_EMBED_DOUBAO: Error Body: {response.text}")
                    # 尝试捕获更详细的错误
                    raise Exception(f"Doubao API Error ({response.status_code}): {response.text}")
                
                result = response.json()
                # Doubao 返回格式可能略有不同，通常是 data.embedding 或 data[0].embedding
                # 某些多模态模型返回的是 {"data": {"embedding": [...]}} 而不是 OpenAI 风格的 {"data": [{"embedding": ...}]}
                if "data" in result:
                    data_field = result["data"]
                    if isinstance(data_field, dict) and "embedding" in data_field:
                         # 格式 1: {"data": {"embedding": [...]}}
                         embeddings.append(data_field["embedding"])
                    elif isinstance(data_field, list) and len(data_field) > 0 and "embedding" in data_field[0]:
                         # 格式 2: {"data": [{"embedding": [...]}]} (OpenAI style)
                         embeddings.append(data_field[0]["embedding"])
                    else:
                         print(f"DEBUG_EMBED_DOUBAO: Unknown data structure: {data_field}")
                         raise Exception("Doubao API response format error: unknown data structure")
                else:
                    print(f"DEBUG_EMBED_DOUBAO: Invalid Response Format (missing 'data'): {result}")
                    raise Exception("Doubao API response format error: missing data/embedding")
                    
            except Exception as e:
                print(f"DEBUG_EMBED_DOUBAO: Failed for text snippet: {e}")
                raise e
        
        return embeddings
