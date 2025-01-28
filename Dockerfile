# Use Node.js 22
FROM node:22

# Set the working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript code
RUN npx tsc

# Expose port
EXPOSE 3000

# Run migrations and start the app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
