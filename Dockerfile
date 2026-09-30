FROM denoland/deno:2.1.4
WORKDIR /app
COPY deno.json server.ts ./
COPY src ./src
COPY public ./public
RUN chown -R deno:deno /app
USER deno
# Pre-fetch npm dependencies (supabase-js, pdf-lib) at build time
RUN deno cache server.ts
ENV PORT=8080
EXPOSE 8080
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "server.ts"]
