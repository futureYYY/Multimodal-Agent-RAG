from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch
import os

def rerank_with_bge_gpu(
    query, 
    passages, 
    model_path=r"E:\业余\Model\bge-reranker-v2-m3",
    max_seq_len=8196  # 模型最大支持长度8196
):
    # 1. 验证模型路径
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"模型路径不存在：{model_path}")
    
    # 2. 检查CUDA可用性
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"使用设备：{device} | 最大文本长度：{max_seq_len}")
    
    # 3. 加载模型和分词器（GPU半精度加速）
    dtype = torch.float16 if device == "cuda" else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        model_path, 
        local_files_only=True, 
        dtype=dtype
    )
    model.eval().to(device)
    
    # 4. 构建输入并编码（最大长度设为8196，仅截断超过模型上限的文本）
    input_texts = [f"query: {query} document: {doc}" for doc in passages]
    encoded = tokenizer(
        input_texts,
        padding=True,
        truncation=True,  # 仅截断超过8196的文本（模型物理上限）
        max_length=max_seq_len,  # 取消512限制，用模型上限8196
        return_tensors="pt"
    ).to(device)
    
    # 5. GPU推理
    with torch.no_grad():
        logits = model(**encoded).logits
    scores = torch.sigmoid(logits).squeeze(dim=1).tolist()
    
    # 6. 按分数排序
    return sorted(zip(passages, scores), key=lambda x: x[1], reverse=True)

# 示例调用
if __name__ == "__main__":
    query = "解释量子纠缠"
    passages = [
        "量子纠缠是一种量子力学现象，指两个或多个粒子即使相隔遥远，其量子状态仍相互关联，对一个粒子的测量会立即影响另一个粒子的状态..." * 100,  # 超长文本测试
        "埃菲尔铁塔位于法国巴黎，建于1889年，是巴黎的地标性建筑，高324米，由古斯塔夫·埃菲尔设计...",
        "纠缠态的粒子无法独立描述其量子状态，这种关联性不受距离限制，是量子通信和量子计算的核心原理之一..."
    ]

    try:
        ranked_docs = rerank_with_bge_gpu(query, passages)
        print("\n=== BGE-reranker(8196长度+GPU)重排结果 ===")
        for i, (doc, score) in enumerate(ranked_docs, 1):
            print(f"{i}. 相关性分数：{score:.4f} | 文档（前60字）：{doc[:60]}...")
    except Exception as e:
        print(f"运行失败：{e}")