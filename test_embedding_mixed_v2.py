import requests
import json

url = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer 1fe06396-ff30-4fe0-88b1-4208a5c95c9b"
}
data = {
    "model": "doubao-embedding-vision-251215",
    "input": [
        {
            "type": "text",
            "text": "天很蓝，海很深"
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "https://ark-project.tos-cn-beijing.volces.com/images/view.jpeg"
            }
        }
    ]
}

try:
    response = requests.post(url, headers=headers, json=data)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        print(response.text[:500])
    else:
        print(response.text)
except Exception as e:
    print(f"Error: {e}")



