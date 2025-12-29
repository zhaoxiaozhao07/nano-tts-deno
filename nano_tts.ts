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
  private ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";
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
    const HASH_MASK_1 = 268435455;
    const HASH_MASK_2 = 266338304;

    let at = 0;
    for (let i = nt.length - 1; i >= 0; i--) {
      const st = nt.charCodeAt(i);
      // JS 位运算在 32 位上有符号进行。为了模拟 Python 的行为，我们需要使用无符号位移和位掩码。
      at = (((at << 6) & HASH_MASK_1) + st + (st << 14)) | 0; // 使用 | 0 确保保持在 32 位有符号整数
      const it = at & HASH_MASK_2;
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

    // 模拟 Python 的 (random.random() * 2147483647) ^ self._e(nt)) * 2147483647
    // 由于涉及大数，可能由于精度丢失产生偏差，但核心算法应保持一致
    const randomVal = Math.round(Math.random() * 2147483647);
    const hash = (randomVal ^ this._e(nt)) >>> 0;
    return hash * 2147483647;
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
      });
      const data = await response.json();

      this.voices = {};
      for (const item of data.data.list) {
        this.voices[item.tag] = {
          name: item.title,
          iconUrl: item.icon,
        };
      }
      console.log(`已加载 ${Object.keys(this.voices).length} 个声音模型`);
    } catch (e) {
      console.error(`加载声音列表失败: ${e}`);
      this.voices["DeepSeek"] = { name: "DeepSeek (默认)", iconUrl: "" };
    }
  }

  /**
   * 获取音频 (支持流式)
   */
  public async getAudio(text: string, voice = "DeepSeek", _stream = false): Promise<Response> {
    const url = `https://bot.n.cn/api/tts/v1?roleid=${voice}`;
    const headers = await this.getHeaders();
    headers["Content-Type"] = "application/x-www-form-urlencoded";

    const body = `&text=${encodeURIComponent(text)}&audio_type=mp3&format=stream`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
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
   * 逐段请求上游，失败则跳过继续
   */
  public async *getAudioChunks(texts: string[], voice = "DeepSeek"): AsyncGenerator<Uint8Array> {
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } catch (e: unknown) {
        const err = e as Error;
        console.error(`[TTS] 第 ${i + 1} 段请求失败，跳过: ${err.message}`);
        // 失败跳过，继续处理下一段
      }
    }
  }
}
