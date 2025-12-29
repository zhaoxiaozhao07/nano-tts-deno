# Nano TTS API

基于 Deno 的 OpenAI 兼容 TTS (Text-to-Speech) API 服务。

## 快速开始

### 本地运行

```bash
deno task dev
```

服务将在 `http://localhost:5050` 启动。

### 部署到 Deno Deploy

直接部署，无需额外配置。入口文件：`server.ts`

## API 接口

### 鉴权

所有 API 请求（除 `/ping`）需要在 Header 中携带：

```
Authorization: Bearer <API_KEY>
```

默认 API Key：`sk-123456`（可通过环境变量 `STATIC_API_KEY` 自定义）

---

### 健康检查

**GET** `/ping`

无需鉴权，返回 `pong`。

---

### 获取可用语音列表

**GET** `/v1/models`

**响应示例：**

```json
{
  "data": [
    {
      "id": "DeepSeek",
      "object": "model",
      "created": 1703836800000,
      "owned_by": "nanoai",
      "description": "DeepSeek 语音"
    }
  ]
}
```

---

### 文本转语音

**POST** `/v1/audio/speech`

**请求体：**

```json
{
  "input": "要转换的文本内容",
  "voice": "DeepSeek",
  "stream": false
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `input` | string | 是 | 要转换的文本 |
| `voice` | string | 否 | 语音模型，默认 `DeepSeek` |
| `stream` | boolean | 否 | 是否流式返回，默认 `false` |

**响应：**

- `Content-Type: audio/mpeg`
- 流式模式：使用 chunked 传输编码
- 非流式模式：返回完整音频数据

---

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `STATIC_API_KEY` | API 鉴权密钥 | `sk-123456` |

