# 使用官方 Deno 镜像
FROM denoland/deno:2.1.4

# 设置工作目录
WORKDIR /app

# 复制依赖配置文件（利用 Docker 缓存）
COPY deno.json deno.lock* ./

# 预缓存依赖
RUN deno cache --import-map=deno.json https://jsr.io/@std/crypto/1.0.4/mod.ts https://jsr.io/@std/encoding/1.0.7/hex.ts || true

# 复制源代码
COPY *.ts ./

# 缓存应用依赖
RUN deno cache server.ts

# 暴露端口
EXPOSE 5050

# 启动命令
CMD ["run", "--allow-net", "--allow-env", "server.ts"]
