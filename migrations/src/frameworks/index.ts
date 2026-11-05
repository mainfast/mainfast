import type { Framework, FrameworkId } from '../types.js';
import { alembic } from './alembic.js';
import { django } from './django.js';
import { drizzle } from './drizzle.js';
import { flyway } from './flyway.js';
import { prisma } from './prisma.js';
import { rails } from './rails.js';

export const frameworks: Record<FrameworkId, Framework> = { alembic, django, prisma, rails, flyway, drizzle };
export { alembic, django, drizzle, flyway, prisma, rails };
