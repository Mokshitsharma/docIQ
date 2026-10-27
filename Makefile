.PHONY: test eval lint dev build clean

test:
	cd backend && npm test

eval:
	cd backend && npm run eval

lint:
	cd backend && npm run lint

dev:
	cd backend && npm run dev

build:
	cd backend && npm install
	cd frontend && npm install

clean:
	rm -rf backend/node_modules/.cache frontend/.next
