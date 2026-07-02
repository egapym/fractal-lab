const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3030

// サーバーを作成する
const server = http.createServer((req, res) => {
  const baseUrl = req.url.split('?')[0]
  console.log(`Request for ${baseUrl}`)

  const url = baseUrl === '/' ? '/index.html' : baseUrl
  const filePath = path.join(__dirname, url)

  const ext = path.extname(filePath)

  let contentType = 'text/html'
  if (ext === '.js' || ext === '.mjs') {
    contentType = 'application/javascript'
  } else if (ext === '.css') {
    contentType = 'text/css'
  } else if (ext === '.mjs') {
    contentType = 'application/javascript'
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Surrogate-Control': 'no-store',
      })
      res.end(data)
    }
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://localhost:${PORT}`)
})
