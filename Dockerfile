FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY tools/package.json tools/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/node_modules node_modules
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
