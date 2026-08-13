import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '4000'),
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET || 'default-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  groqApiKey: process.env.GROQ_API_KEY || '',
  openCodeZenApiKey: process.env.OPENCODE_ZEN_API_KEY || '',
  openCodeZenBaseUrl: process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
  openCodeServeUrl: process.env.OPENCODE_SERVE_URL || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
}