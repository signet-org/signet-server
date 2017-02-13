#!/usr/bin/env node
const express = require('express')
const bodyParser = require('body-parser')
const levelup = require('levelup')
const morgan = require('morgan')
const groupBy = require('lodash.groupby')
const map = require('lodash.map')

const argv = require('yargs')
  .usage('Usage: $0 -p [port]')
  .number('p')
  .default('p', 8080)
  .argv

const db = levelup('./signetdb', {valueEncoding: 'json'})

const app = express()
app.use(bodyParser.json())
app.use(morgan('combined'))

function getAttestations(id) {
  return new Promise((resolve, reject) => {
    db.get('/sig/' + id, (err, storedValue) => {
      if (err) {
        if (err.notFound) {
          return resolve([])
        }
        return reject(err)
      }
      resolve(storedValue.attestations)
    })
  })
}

function saveAttestations(newAttestations) {
  const byId = groupBy(newAttestations, v => v.data.id)

  const promises = map(byId, (newAttestationsForId, id) =>
    new Promise((resolve, reject) => {
      db.get('/sig/' + id, (err, storedValue) => {
        let storedAttestations = []
        if (err && !err.notFound) {
          return reject(err)
        } else if (storedValue) {
          storedAttestations = storedValue.attestations
        }

        const attestations = storedAttestations.concat(newAttestationsForId)

        db.put('/sig/' + id, {attestations}, err => {
          if (err) {
            return reject(err)
          }
          console.info(`Saved ${newAttestationsForId.length} attestations for ${id}.`)
          resolve()
        })
      })
    })
  )

  return Promise.all(promises)
}

app.get('/sig/:id', (req, res) => {
  getAttestations(req.params.id)
    .catch(err => {
      console.error(err)
      res.status(500).json({ok: false, error: 'internal error'})
      return
    })
    .then(attestations => {
      res.json({ok: true, attestations})
    })
})

app.post('/sig', (req, res) => {
  const data = req.body
  let valid = false

  if (data && data.attestations && Array.isArray(data.attestations)) {
    valid = data.attestations.every(v => !!v.data && !!v.data.id && v.data.hasOwnProperty('ok'))
  }

  if (!valid) {
    res.json({ok: false, error: 'invalid data'})
    return
  }

  saveAttestations(data.attestations)
    .catch(err => {
      console.error(err)
      res.status(500).json({ok: false, error: 'internal error'})
    })
    .then(() => {
      res.json({ok: true})
    })
})

app.use(function(err, req, res, next) {
  console.error(err.stack)
  res.status(500).send({ok: false, error: 'internal error'})
})

app.listen(argv.p)
