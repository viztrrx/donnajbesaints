FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
USER node
ENV BIND_ADDRESS=0.0.0.0 PORT=8789 SNAPSHOT_PATH=/data/devices.json
EXPOSE 8789
CMD ["node", "server.mjs"]
