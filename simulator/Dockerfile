FROM node:20-alpine

WORKDIR /app

# Copy simulator package
COPY simulator/package.json simulator/package-lock.json* ./simulator/
RUN cd simulator && npm ci --omit=dev

# Root package metadata: the engine and the simulator read their version from it
COPY package.json ./

# Copy scoring engine source and data
COPY src/ ./src/
COPY data/ ./data/

# Copy simulator code
COPY simulator/ ./simulator/

WORKDIR /app/simulator

# Inside the container the server must listen on every interface; the compose
# file publishes the port on the workstation's loopback only.
ENV SIMULATOR_HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "server.js"]
