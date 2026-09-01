import type { ResourceConnectorCapabilityV1 } from '@local-creative-os/contracts'

export interface ResourceConnectorPort<TScan = unknown> {
  readonly capability: ResourceConnectorCapabilityV1
  scan(source: string): Promise<TScan>
}

export class ResourceConnectorRegistry {
  readonly #connectors = new Map<string, ResourceConnectorPort>()

  constructor(connectors: readonly ResourceConnectorPort[] = []) {
    for (const connector of connectors) this.register(connector)
  }

  register(connector: ResourceConnectorPort): void {
    const id = connector.capability.connector.trim()
    if (!id) throw new Error('Connector capability requires an id.')
    if (this.#connectors.has(id)) throw new Error(`Connector is already registered: ${id}`)
    this.#connectors.set(id, connector)
  }

  get<TScan = unknown>(connector: string): ResourceConnectorPort<TScan> | undefined {
    return this.#connectors.get(connector) as ResourceConnectorPort<TScan> | undefined
  }

  capabilities(): readonly ResourceConnectorCapabilityV1[] {
    return [...this.#connectors.values()]
      .map((connector) => connector.capability)
      .sort((left, right) => left.connector.localeCompare(right.connector, 'en'))
  }
}
