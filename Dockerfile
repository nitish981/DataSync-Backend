FROM node:18-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --only=production
COPY src ./src
EXPOSE 8080
CMD ["npm", "start"]
