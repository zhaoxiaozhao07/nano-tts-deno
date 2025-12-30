/**
 * server.ts
 * 纳米AI TTS API 服务 (OpenAI 兼容)
 */

import { NanoAITTS } from "./nano_tts.ts";

const tts = new NanoAITTS();

// 服务启动时间 (用于 /v1/models 响应的 created 字段)
const SERVICE_START_TIME = Date.now();
// 最大输入文本长度
const MAX_INPUT_LENGTH = 4000;

// 生成请求ID
function generateRequestId(): string {
    return crypto.randomUUID().slice(0, 8);
}

console.log("-----------------------------------------");
console.log("正在初始化语音引擎...");
try {
    await tts.loadVoices();
    console.log("语音引擎初始化成功");
} catch (e: any) {
    console.error("警告: 语音引擎初始化失败:", e.message);
}
console.log("-----------------------------------------");

const STATIC_API_KEY = Deno.env.get("STATIC_API_KEY") ?? "sk-123456";

// CORS 头部
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 检测是否在 Deno Deploy 环境中运行
const isDenoDeployEnv = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const reqId = generateRequestId();
    console.log(`[${reqId}] 收到请求: ${req.method} ${url.pathname}`);

    // --- CORS 预检请求 ---
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // --- 路由: /ping (测试用) ---
    if (url.pathname === "/ping") {
        return new Response("pong", { status: 200, headers: CORS_HEADERS });
    }

    // --- 鉴权逻辑 ---
    const auth = req.headers.get("Authorization");
    if (!auth || auth !== `Bearer ${STATIC_API_KEY}`) {
        console.warn(`[${reqId}] 鉴权失败: ${auth ? "API Key 错误" : "缺失 Authorization 头部"}`);
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
    }

    // --- 路由: /v1/models ---
    if (url.pathname === "/v1/models" && req.method === "GET") {
        const models = Object.entries(tts.voices).map(([id, info]) => ({
            id,
            object: "model",
            created: SERVICE_START_TIME,
            owned_by: "nanoai",
            description: info.name,
        }));
        return new Response(JSON.stringify({ data: models }), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
    }

    // --- 路由: /v1/audio/speech ---
    if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
        try {
            const body = await req.json();
            const { voice, input, stream } = body;

            if (!input) {
                return new Response(JSON.stringify({ error: "Missing input" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
                });
            }

            // 校验输入长度
            if (input.length > MAX_INPUT_LENGTH) {
                console.warn(`[${reqId}] 输入超长: ${input.length} > ${MAX_INPUT_LENGTH}`);
                return new Response(JSON.stringify({
                    error: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters`
                }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
                });
            }

            // 校验 voice 是否支持，不支持则默认使用 DeepSeek
            const supportedVoices = Object.keys(tts.voices);
            const selectedVoice = (voice && supportedVoices.includes(voice)) ? voice : "DeepSeek";
            if (voice && voice !== selectedVoice) {
                console.log(`[${reqId}] 不支持的语音模型: ${voice}，已回退到默认值: DeepSeek`);
            }

            // 拆分文本
            const textChunks = tts.splitText(input, 200);
            console.log(`[${reqId}] TTS请求: voice=${selectedVoice}, 文本长度=${input.length}, 拆分为 ${textChunks.length} 段, stream=${!!stream}`);

            if (stream) {
                // 流式响应：边收边发
                const readableStream = new ReadableStream({
                    async start(controller) {
                        try {
                            for await (const chunk of tts.getAudioChunks(textChunks, selectedVoice)) {
                                controller.enqueue(chunk);
                            }
                            controller.close();
                        } catch (e) {
                            controller.error(e);
                        }
                    },
                });

                return new Response(readableStream, {
                    headers: {
                        "Content-Type": "audio/mpeg",
                        "Transfer-Encoding": "chunked",
                        ...CORS_HEADERS,
                    },
                });
            } else {
                // 非流式响应：收集完毕后一并返回
                const chunks: Uint8Array[] = [];
                for await (const chunk of tts.getAudioChunks(textChunks, selectedVoice)) {
                    chunks.push(chunk);
                }

                // 合并所有 chunk
                const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
                const result = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    result.set(chunk, offset);
                    offset += chunk.length;
                }

                console.log(`[${reqId}] 非流式响应完成，总大小: ${totalLength} bytes`);

                return new Response(result, {
                    headers: {
                        "Content-Type": "audio/mpeg",
                        "Content-Length": String(totalLength),
                        ...CORS_HEADERS,
                    },
                });
            }
        } catch (e) {
            return new Response(JSON.stringify({ error: (e as Error).message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            });
        }
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
};

// 根据环境选择启动方式
if (isDenoDeployEnv) {
    // Deno Deploy 环境：不指定端口，由平台自动分配
    Deno.serve(handler);
} else {
    // 本地开发环境：使用固定端口
    Deno.serve({
        port: 5050,
        hostname: "0.0.0.0",
        onListen({ port, hostname }: { port: number; hostname: string }) {
            console.log(`🚀 TTS API 服务已就绪`);
            console.log(`📡 本地访问: http://localhost:${port}`);
            console.log(`🌐 监听地址: http://${hostname}:${port} (支持外部访问)`);
        }
    }, handler);
}
