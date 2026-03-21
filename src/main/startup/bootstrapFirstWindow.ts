export interface FirstWindowBootstrap<TWindow> {
  initStores: () => Promise<void>
  registerWindowHandlers: () => Promise<void> | void
  registerUpdaterHandlers: () => Promise<void> | void
  registerCriticalIpcHandlers: () => Promise<void> | void
  createWindow: () => TWindow
  initializeWindowServices: (window: TWindow) => Promise<void> | void
}

export async function bootstrapFirstWindow<TWindow>(
  bootstrap: FirstWindowBootstrap<TWindow>,
): Promise<TWindow> {
  await bootstrap.initStores()
  await bootstrap.registerWindowHandlers()
  await bootstrap.registerUpdaterHandlers()
  await bootstrap.registerCriticalIpcHandlers()

  const firstWindow = bootstrap.createWindow()
  await bootstrap.initializeWindowServices(firstWindow)

  return firstWindow
}
