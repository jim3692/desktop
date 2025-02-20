import type { ConfigData } from './app';

import { app, BrowserWindow, shell, ipcMain, nativeImage, Tray, Menu, App } from 'electron';
import windowStateKeeper from 'electron-window-state';
import { RelaunchOptions } from 'electron/main';
import { URL } from 'url';
import path from 'path';

import { firstRun, getConfig, store, onStart, getBuildURL } from './lib/config';
import { connectRPC, dropRPC } from './lib/discordRPC';
import { autoLaunch } from './lib/autoLaunch';
import { autoUpdate } from './lib/updater';

interface AppQuitting { isQuitting: boolean; }

const WindowIcon = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
WindowIcon.setTemplateImage(true);

onStart();
autoUpdate();

var relaunch: boolean | undefined;
var mainWindow: BrowserWindow;
function createWindow() {
	const initialConfig = getConfig();
	const mainWindowState = windowStateKeeper({
		defaultWidth: 1280,
		defaultHeight: 720
	});

	mainWindow = new BrowserWindow({
		autoHideMenuBar: true,
		title: 'Revolt',
		icon: WindowIcon,

		frame: initialConfig.frame,

		webPreferences: {
			preload: path.resolve(app.getAppPath(), 'bundle', 'app.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},

		x: mainWindowState.x,
		y: mainWindowState.y,
		width: mainWindowState.width,
		height: mainWindowState.height,

		minWidth: 480,
		minHeight: 300
	})
	
	mainWindowState.manage(mainWindow)
	mainWindow.loadURL(getBuildURL())

	mainWindow.webContents.on('did-finish-load', () =>
		mainWindow.webContents.send('config', getConfig())
	)

	mainWindow.on('show', () => tray.setContextMenu(contextMenu()))
	mainWindow.on('hide', () => tray.setContextMenu(contextMenu()))
	mainWindow.on('close', function (event) {
		if(!(app as App & AppQuitting).isQuitting){
			event.preventDefault();
			mainWindow.hide();
		}
	
		return false;
	})

	ipcMain.on('getAutoStart', () =>
		autoLaunch.isEnabled()
			.then(v => mainWindow.webContents.send('autoStart', v))
	)

	ipcMain.on('setAutoStart', async (_, value: boolean) => {
		if (value) {
			await autoLaunch.enable();
			mainWindow.webContents.send('autoStart', true);
		} else {
			await autoLaunch.disable();
			mainWindow.webContents.send('autoStart', false);
		}
	})

	ipcMain.on('set', (_, arg: Partial<ConfigData>) => {
		if (typeof arg.discordRPC !== 'undefined') {
			if (arg.discordRPC) {
				connectRPC();
			} else {
				dropRPC();
			}
		}

		store.set('config', {
			...store.get('config'),
			...arg
		})
	})

	ipcMain.on('reload', () => mainWindow.loadURL(getBuildURL()))
	ipcMain.on('relaunch', () => {
		relaunch = true;
		mainWindow.close();
	})

	ipcMain.on('min', () => mainWindow.minimize())
	ipcMain.on('max', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
	ipcMain.on('close', () => mainWindow.close())
}

const contextMenu = () => Menu.buildFromTemplate([
	...(mainWindow.isVisible() ? [] : [{ label: 'Show', click() { mainWindow.show(); } }]),
	{ label:'Quit', click() { (app as App & AppQuitting).isQuitting = true; app.quit() } }
])
let tray : Tray;
function createTrayIcon () {
	tray = new Tray(WindowIcon)
	tray.setContextMenu(contextMenu())
}

app.whenReady().then(async () => {
	await firstRun();
	createWindow();
	createTrayIcon();
	
	app.on('activate', function () {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', function () {
	if (relaunch) {
		const options: RelaunchOptions = {
			args: process.argv.slice(1).concat(['--relaunch']),
			execPath: process.execPath
		};

		if (app.isPackaged && process.env.APPIMAGE) {
			options.execPath = process.env.APPIMAGE;
    		options.args!.unshift('--appimage-extract-and-run');
		}
		
		app.relaunch(options);
		app.quit();

		return;
	}

	if (process.platform !== 'darwin') app.quit()
})

app.on('web-contents-created', (_, contents) => {
	contents.on('will-navigate', (event, navigationUrl) => {
		const parsedUrl = new URL(navigationUrl)
		
		if (parsedUrl.origin !== getBuildURL()) {
			event.preventDefault()
		}
	})

	contents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
			setImmediate(() => {
				shell.openExternal(url)
			})
		}
		
		return { action: 'deny' }
	})
})
