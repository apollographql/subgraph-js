# Built from the repository root so the workspace can resolve @apollo/subgraph:
#   podman build -f compatibility/Dockerfile ..
FROM node:24-alpine

WORKDIR /app

COPY package.json tsconfig.json ./
COPY compatibility/package.json ./compatibility/
RUN npm install --no-audit --no-fund

COPY src ./src
COPY compatibility ./compatibility

RUN npm run build && npm run build --workspace @apollo/subgraph-compatibility

EXPOSE 4001
CMD ["node", "compatibility/dist/index.js"]
