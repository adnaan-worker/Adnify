/**
 * MCP 状态管理 Slice
 */

import { StateCreator } from 'zustand'
import type { McpServerState, McpServerStatus, McpTool, McpResource } from '@shared/types/mcp'

export interface McpSlice {
  // 状态
  mcpServers: McpServerState[]
  mcpInitialized: boolean
  mcpLoading: boolean
  mcpError: string | null

  // Actions
  setMcpServers: (servers: McpServerState[]) => void
  setMcpInitialized: (initialized: boolean) => void
  setMcpLoading: (loading: boolean) => void
  setMcpError: (error: string | null) => void
  updateMcpServerStatus: (serverId: string, status: McpServerStatus, error?: string) => void
  updateMcpServerTools: (serverId: string, tools: McpTool[]) => void
  updateMcpServerResources: (serverId: string, resources: McpResource[]) => void

  // Selectors
  getMcpServer: (serverId: string) => McpServerState | undefined
  getConnectedMcpServers: () => McpServerState[]
  getAllMcpTools: () => Array<McpTool & { serverId: string; serverName: string }>
  getAllMcpResources: () => Array<McpResource & { serverId: string; serverName: string }>
}

export const createMcpSlice: StateCreator<McpSlice, [], [], McpSlice> = (set, get) => ({
  // 初始状态
  mcpServers: [],
  mcpInitialized: false,
  mcpLoading: false,
  mcpError: null,

  // Actions
  setMcpServers: (servers) => set({ mcpServers: servers }),
  
  setMcpInitialized: (initialized) => set({ mcpInitialized: initialized }),
  
  setMcpLoading: (loading) => set({ mcpLoading: loading }),
  
  setMcpError: (error) => set({ mcpError: error }),

  updateMcpServerStatus: (serverId, status, error) => set((state) => ({
    mcpServers: state.mcpServers.map(server =>
      server.id === serverId
        ? { ...server, status, error }
        : server
    ),
  })),

  updateMcpServerTools: (serverId, tools) => set((state) => ({
    mcpServers: state.mcpServers.map(server =>
      server.id === serverId
        ? { ...server, tools }
        : server
    ),
  })),

  updateMcpServerResources: (serverId, resources) => set((state) => ({
    mcpServers: state.mcpServers.map(server =>
      server.id === serverId
        ? { ...server, resources }
        : server
    ),
  })),

  // Selectors
  getMcpServer: (serverId) => {
    return get().mcpServers.find(s => s.id === serverId)
  },

  getConnectedMcpServers: () => {
    return get().mcpServers.filter(s => s.status === 'connected')
  },

  getAllMcpTools: () => {
    const tools: Array<McpTool & { serverId: string; serverName: string }> = []
    for (const server of get().mcpServers) {
      if (server.status === 'connected') {
        for (const tool of server.tools) {
          tools.push({
            ...tool,
            serverId: server.id,
            serverName: server.config.name,
          })
        }
      }
    }
    return tools
  },

  getAllMcpResources: () => {
    const resources: Array<McpResource & { serverId: string; serverName: string }> = []
    for (const server of get().mcpServers) {
      if (server.status === 'connected') {
        for (const resource of server.resources) {
          resources.push({
            ...resource,
            serverId: server.id,
            serverName: server.config.name,
          })
        }
      }
    }
    return resources
  },
})
