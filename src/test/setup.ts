// Per-file setup: point the app's db client at the scratch DB and give the
// crypto layer a throwaway key generated fresh for this run (never a fixture).
import { randomBytes } from 'node:crypto'

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
if (!process.env.INTEGRATION_ENC_KEY) process.env.INTEGRATION_ENC_KEY = randomBytes(32).toString('base64')
process.env.PUBLIC_BASE_URL = 'https://tickets.test'
