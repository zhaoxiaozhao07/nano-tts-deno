/**
 * server.ts
 * 纳米AI TTS API 服务 (OpenAI 兼容)
 */

import { NanoAITTS } from "./nano_tts.ts";

const tts = new NanoAITTS();

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

Deno.serve({
    port: 5050,
    hostname: "0.0.0.0",
    onListen({ port, hostname }: { port: number; hostname: string }) {
        console.log(`🚀 TTS API 服务已就绪`);
        console.log(`📡 本地访问: http://localhost:${port}`);
        console.log(`🌐 监听地址: http://${hostname}:${port} (支持外部访问)`);
    }
}, async (req: Request) => {
    const url = new URL(req.url);
    console.log(`[${new Date().toLocaleTimeString()}] 收到请求: ${req.method} ${url.pathname}`);

    // --- 路由: /ping (测试用) ---
    if (url.pathname === "/ping") {
        return new Response("pong", { status: 200 });
    }

    // --- 鉴权逻辑 ---
    const auth = req.headers.get("Authorization");
    if (!auth || auth !== `Bearer ${STATIC_API_KEY}`) {
        console.warn(`[Auth] 鉴权失败: ${auth ? "API Key 错误" : "缺失 Authorization 头部"}`);
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    // --- 路由: /v1/models ---
    if (url.pathname === "/v1/models" && req.method === "GET") {
        const models = Object.entries(tts.voices).map(([id, info]) => ({
            id,
            object: "model",
            created: Date.now(),
            owned_by: "nanoai",
            description: info.name,
        }));
        return new Response(JSON.stringify({ data: models }), {
            headers: { "Content-Type": "application/json" },
        });
    }

    // --- 路由: /v1/audio/speech ---
    if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
        try {
            const body = await req.json();
            const { model, input, stream } = body;

            if (!model || !input) {
                return new Response(JSON.stringify({ error: "Missing model or input" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }

            // 拆分文本
            const textChunks = tts.splitText(input, 200);
            console.log(`[TTS] 请求: model=${model}, 文本长度=${input.length}, 拆分为 ${textChunks.length} 段, stream=${!!stream}`);

            if (stream) {
                // 流式响应：边收边发
                const readableStream = new ReadableStream({
                    async start(controller) {
                        try {
                            for await (const chunk of tts.getAudioChunks(textChunks, model)) {
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
                    },
                });
            } else {
                // 非流式响应：收集完毕后一并返回
                const chunks: Uint8Array[] = [];
                for await (const chunk of tts.getAudioChunks(textChunks, model)) {
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

                console.log(`[TTS] 非流式响应完成，总大小: ${totalLength} bytes`);

                return new Response(result, {
                    headers: {
                        "Content-Type": "audio/mpeg",
                        "Content-Length": String(totalLength),
                    },
                });
            }
        } catch (e) {
            return new Response(JSON.stringify({ error: (e as Error).message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    }

    return new Response("Not Found", { status: 404 });
});
