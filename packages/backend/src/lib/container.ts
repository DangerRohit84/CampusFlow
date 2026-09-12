// lib/container.ts — minimal DI container (DIP factory, explicit init/teardown).
// WHY: replaces module-global singletons with constructed deps. Default wiring
// uses the Prisma singleton; tests call `resetContainerForTests()` + register fakes.

import prisma from '../config/db'

type Factory<T> = () => T

class Container {
  private factories = new Map<string, Factory<unknown>>()
  private instances = new Map<string, unknown>()

  register<T>(key: string, factory: Factory<T>): void {
    this.factories.set(key, factory as Factory<unknown>)
    this.instances.delete(key)
  }

  resolve<T>(key: string): T {
    if (this.instances.has(key)) return this.instances.get(key) as T
    const factory = this.factories.get(key)
    if (!factory) throw new Error(`DI: no provider for "${key}"`)
    const instance = factory() as T
    this.instances.set(key, instance)
    return instance
  }

  reset(): void {
    this.instances.clear()
  }
}

export const container = new Container()

export const TOKENS = {
  prisma: 'prisma',
} as const

// Default wiring (explicit init at boot; teardown via $disconnect in index.ts).
container.register(TOKENS.prisma, () => prisma)

export function getPrisma(): typeof prisma {
  return container.resolve<typeof prisma>(TOKENS.prisma)
}

export function resetContainerForTests(): void {
  container.reset()
  container.register(TOKENS.prisma, () => prisma)
}
