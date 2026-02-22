.PHONY: all daemon menubar install uninstall dmg clean

all: daemon menubar

daemon:
	cd daemon && pnpm install && pnpm build

menubar:
	cd menubar && swift build -c release && bash bundle.sh

install: all
	cd daemon && bash install-service.sh
	mkdir -p ~/Applications
	cp -R "menubar/build/Gemini Daemon.app" ~/Applications/
	open ~/Applications/Gemini\ Daemon.app

uninstall:
	bash daemon/pkg/uninstall.sh

dmg:
	bash build-dmg.sh

clean:
	rm -rf daemon/dist
	rm -rf menubar/.build menubar/build
