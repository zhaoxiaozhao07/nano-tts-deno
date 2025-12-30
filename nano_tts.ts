/**
 * nano_tts.ts
 * 纳米AI TTS 核心逻辑 (Deno 版本)
 */

import { crypto as stdCrypto } from "jsr:@std/crypto@1.0.4";
import { encodeHex } from "jsr:@std/encoding@1.0.7/hex";

export interface VoiceInfo {
  name: string;
  iconUrl: string;
}

export class NanoAITTS {
  // 哈希算法用常量
  private static readonly HASH_MASK_1 = 268435455;   // 0x0FFFFFFF
  private static readonly HASH_MASK_2 = 266338304;   // 0x0FE00000
  private static readonly INT32_MAX = 2147483647;    // 0x7FFFFFFF (32位有符号整数最大值)

  private ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";
  private readonly FETCH_TIMEOUT_MS = 30000; // 30秒超时
  public voices: Record<string, VoiceInfo> = {};

  constructor() { }

  /**
   * MD5 哈希函数 (使用 Deno 标准库)
   */
  private async md5(msg: string): Promise<string> {
    const data = new TextEncoder().encode(msg);
    const hashBuffer = await stdCrypto.subtle.digest("MD5", data);
    return encodeHex(new Uint8Array(hashBuffer));
  }

  /**
   * 核心位运算逻辑，保留与 Python 版本一致的溢出处理
   */
  private _e(nt: string): number {
    let at = 0;
    for (let i = nt.length - 1; i >= 0; i--) {
      const st = nt.charCodeAt(i);
      // JS 位运算在 32 位上有符号进行。为了模拟 Python 的行为，我们需要使用无符号位移和位掩码。
      at = (((at << 6) & NanoAITTS.HASH_MASK_1) + st + (st << 14)) | 0;
      const it = at & NanoAITTS.HASH_MASK_2;
      if (it !== 0) {
        at = at ^ (it >>> 21); // 使用无符号右移
      }
    }
    return at;
  }

  private generateUniqueHash(): number {
    const lang = "zh-CN";
    const appName = "chrome";
    const ver = 1.0;
    const platform = "Win32";
    const width = 1920;
    const height = 1080;
    const colorDepth = 24;
    const referrer = "https://bot.n.cn/chat";

    let nt = `${appName}${ver}${lang}${platform}${this.ua}${width}x${height}${colorDepth}${referrer}`;
    let at = nt.length;
    let it = 1;

    while (it) {
      nt += String(it ^ at);
      it -= 1;
      at += 1;
    }

    // 模拟 Python 的大数运算
    const randomVal = Math.round(Math.random() * NanoAITTS.INT32_MAX);
    const hash = (randomVal ^ this._e(nt)) >>> 0;
    return hash * NanoAITTS.INT32_MAX;
  }

  private generateMid(): string {
    const domain = "https://bot.n.cn";
    const rt = String(this._e(domain)) + String(this.generateUniqueHash()) + String(Date.now() + Math.random() + Math.random());
    return rt.replace(".", "e").slice(0, 32);
  }

  private getIso8601Time(): string {
    const now = new Date();
    // 简单实现 +08:00 格式
    const offset = 8;
    const d = new Date(now.getTime() + offset * 3600 * 1000);
    return d.toISOString().replace("Z", "+08:00");
  }

  /**
   * 生成请求头
   */
  public async getHeaders(): Promise<Record<string, string>> {
    const device = "Web";
    const ver = "1.2";
    const timestamp = this.getIso8601Time();
    const accessToken = this.generateMid();
    const zmUa = await this.md5(this.ua);

    const zmTokenStr = `${device}${timestamp}${ver}${accessToken}${zmUa}`;
    const zmToken = await this.md5(zmTokenStr);

    return {
      "device-platform": device,
      "timestamp": timestamp,
      "access-token": accessToken,
      "zm-token": zmToken,
      "zm-ver": ver,
      "zm-ua": zmUa,
      "User-Agent": this.ua,
    };
  }

  /**
   * 加载声音列表 (Deno Deploy 兼容：无文件系统依赖)
   */
  public async loadVoices(): Promise<void> {
    try {
      console.log("正在从 API 加载模型列表...");
      const response = await fetch("https://bot.n.cn/api/robot/platform", {
        headers: await this.getHeaders(),
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP 错误: ${response.status}`);
      }

      const data = await response.json();

      // 校验 API 响应结构
      if (!data || typeof data !== "object") {
        throw new Error("API 响应格式无效: 非对象类型");
      }
      if (!data.data || !Array.isArray(data.data.list)) {
        throw new Error("API 响应格式无效: 缺少 data.list 数组");
      }

      this.voices = {};
      for (const item of data.data.list) {
        // 校验每个 item 的必要字段
        if (item && typeof item.tag === "string") {
          this.voices[item.tag] = {
            name: item.title || item.tag,
            iconUrl: item.icon || "",
          };
        }
      }

      if (Object.keys(this.voices).length === 0) {
        throw new Error("API 未返回有效的声音模型");
      }

      console.log(`已加载 ${Object.keys(this.voices).length} 个声音模型`);
    } catch (e) {
      const err = e as Error;
      console.error(`加载声音列表失败: ${err.message}`);
      // 回退到默认值
      this.voices["DeepSeek"] = { name: "DeepSeek (默认)", iconUrl: "" };
    }
  }

  /**
   * 获取音频 (支持流式)
   */
  public async getAudio(text: string, voice = "DeepSeek"): Promise<Response> {
    const url = `https://bot.n.cn/api/tts/v1?roleid=${voice}`;
    const headers = await this.getHeaders();
    headers["Content-Type"] = "application/x-www-form-urlencoded";

    const body = `&text=${encodeURIComponent(text)}&audio_type=mp3&format=stream`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status}`);
    }

    return response;
  }

  /**
   * 按句子拆分文本，每段最大 maxLen 字符
   * 1. 首先按句号、问号、感叹号、换行拆分
   * 2. 如果某段超过 maxLen，再按逗号拆分
   */
  public splitText(text: string, maxLen = 200): string[] {
    if (text.length <= maxLen) {
      return [text];
    }

    // 第一层：按句子分隔符拆分
    const sentenceDelimiters = /([。？！.?!\n])/;
    const sentenceParts = text.split(sentenceDelimiters);

    // 重组句子（保留分隔符）
    const sentences: string[] = [];
    for (let i = 0; i < sentenceParts.length; i += 2) {
      const content = sentenceParts[i] || "";
      const delimiter = sentenceParts[i + 1] || "";
      if (content || delimiter) {
        sentences.push(content + delimiter);
      }
    }

    // 第二层：如果句子超过 maxLen，按逗号拆分
    const result: string[] = [];
    for (const sentence of sentences) {
      if (sentence.length <= maxLen) {
        result.push(sentence);
      } else {
        // 按逗号拆分
        const commaDelimiters = /([,，])/;
        const commaParts = sentence.split(commaDelimiters);

        // 重组片段
        let current = "";
        for (let i = 0; i < commaParts.length; i++) {
          const part = commaParts[i] || "";
          if ((current + part).length <= maxLen) {
            current += part;
          } else {
            if (current) result.push(current);
            current = part;
          }
        }
        if (current) result.push(current);
      }
    }

    // 过滤空字符串
    return result.filter(s => s.trim().length > 0);
  }

  /**
   * 获取多段音频的 AsyncGenerator
   * 支持有限并发请求，失败则跳过继续
   * @param texts 文本段落数组
   * @param voice 语音模型
   * @param concurrency 最大并发数（默认为 3）
   */
  public async * getAudioChunks(
    texts: string[],
    voice = "DeepSeek",
    concurrency = 3
  ): AsyncGenerator<Uint8Array> {
    // 如果并发数为 1 或文本段落少，使用串行模式
    if (concurrency <= 1 || texts.length <= 2) {
      yield* this.getAudioChunksSerial(texts, voice);
      return;
    }

    // 并发模式：按批次并行获取，保持顺序输出
    const results: (Uint8Array | null)[] = new Array(texts.length).fill(null);

    // 单个文本段的获取任务
    const fetchOne = async (index: number): Promise<void> => {
      const text = texts[index];
      console.log(`[TTS] 处理第 ${index + 1}/${texts.length} 段: "${text.slice(0, 30)}..."`);

      try {
        const response = await this.getAudio(text, voice);
        const reader = response.body?.getReader();

        if (!reader) {
          console.warn(`[TTS] 第 ${index + 1} 段无响应体，跳过`);
          return;
        }

        // 读取整个响应到内存
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }

        // 合并 chunks
        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        results[index] = merged;
      } catch (e: unknown) {
        const err = e as Error;
        console.error(`[TTS] 第 ${index + 1} 段请求失败，跳过: ${err.message}`);
      }
    };

    // 分批处理
    for (let batchStart = 0; batchStart < texts.length; batchStart += concurrency) {
      const batchEnd = Math.min(batchStart + concurrency, texts.length);
      const batchPromises: Promise<void>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        batchPromises.push(fetchOne(i));
      }

      // 等待当前批次完成
      await Promise.all(batchPromises);

      // 按顺序 yield 当前批次的结果
      for (let i = batchStart; i < batchEnd; i++) {
        if (results[i]) {
          yield results[i]!;
        }
      }
    }
  }

  /**
   * 串行获取音频（保持原始逻辑，用于低并发场景）
   */
  private async * getAudioChunksSerial(texts: string[], voice: string): AsyncGenerator<Uint8Array> {
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      console.log(`[TTS] 处理第 ${i + 1}/${texts.length} 段: "${text.slice(0, 30)}..."`);

      try {
        const response = await this.getAudio(text, voice);
        const reader = response.body?.getReader();

        if (!reader) {
          console.warn(`[TTS] 第 ${i + 1} 段无响应体，跳过`);
          continue;
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) yield value;
          }
        } finally {
          reader.releaseLock();
        }
      } catch (e: unknown) {
        const err = e as Error;
        console.error(`[TTS] 第 ${i + 1} 段请求失败，跳过: ${err.message}`);
      }
    }
  }
}
