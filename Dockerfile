FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_SPEED_INSIGHTS=false
ENV VITE_SPEED_INSIGHTS=$VITE_SPEED_INSIGHTS
RUN npm run build
RUN npm run serve:build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-build ./server-build
EXPOSE 3000
CMD ["node", "server-build/server/serve.js"]
