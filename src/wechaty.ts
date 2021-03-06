/**
 *   Wechaty - https://github.com/chatie/wechaty
 *
 *   Copyright 2016-2017 Huan LI <zixia@zixia.net>
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 */
import { EventEmitter } from 'events'

import { StateSwitch }  from 'state-switch'

import {
  config,
  HeadName,
  PuppetName,
  Raven,
  Sayable,
  log,
}                         from './config'

import { Contact }        from './contact'
import { FriendRequest }  from './friend-request'
import {
  Message,
  MediaMessage,
}                         from './message'
import { Puppet }         from './puppet'
import { PuppetWeb }      from './puppet-web/'
import { Room }           from './room'
import { UtilLib }        from './util-lib'

export interface PuppetSetting {
  head?:    HeadName,
  puppet?:  PuppetName,
  profile?: string,
}

export type WechatyEventName = 'error'
                              | 'friend'
                              | 'heartbeat'
                              | 'login'
                              | 'logout'
                              | 'message'
                              | 'room-join'
                              | 'room-leave'
                              | 'room-topic'
                              | 'scan'
                              | 'EVENT_PARAM_ERROR'

/**
 *
 * Wechaty: Wechat for ChatBots.
 * Connect ChatBots
 *
 * Class Wechaty
 *
 * Licenst: ISC
 * https://github.com/zixia/wechaty
 *
 *
 * **Example**
 *
 * ```ts
 * // The World's Shortest ChatBot Code: 6 lines of JavaScript
 * const { Wechaty } = require('wechaty')
 *
 * Wechaty.instance() // Singleton
 * .on('scan', (url, code) => console.log(`Scan QR Code to login: ${code}\n${url}`))
 * .on('login',       user => console.log(`User ${user} logined`))
 * .on('message',  message => console.log(`Message: ${message}`))
 * .init()
 * ```
 * @see The <a href="https://github.com/lijiarui/wechaty-getting-started">Wechaty Starter Project</a>
 */
export class Wechaty extends EventEmitter implements Sayable {
  /**
   * singleton _instance
   * @private
   */
  private static _instance: Wechaty

  /**
   * the puppet
   * @private
   */
  public puppet: Puppet | null

  /**
   * the state
   * @private
   */
  private state = new StateSwitch<'standby', 'ready'>('Wechaty', 'standby', log)

  /**
   * the uuid
   * @private
   */
  public uuid:        string

  /**
   * get the singleton instance of Wechaty
   */
  public static instance(setting?: PuppetSetting) {
    if (setting && this._instance) {
      throw new Error('there has already a instance. no params will be allowed any more')
    }
    if (!this._instance) {
      this._instance = new Wechaty(setting)
    }
    return this._instance
  }

  /**
   * @private
   */
  private constructor(private setting: PuppetSetting = {}) {
    super()
    log.verbose('Wechaty', 'contructor()')

    setting.head    = setting.head    || config.head
    setting.puppet  = setting.puppet  || config.puppet
    setting.profile = setting.profile || config.profile

    // setting.port    = setting.port    || Config.port

    if (setting.profile) {
      setting.profile  = /\.wechaty\.json$/i.test(setting.profile)
                        ? setting.profile
                        : setting.profile + '.wechaty.json'
    }

    this.uuid = UtilLib.guid()
  }

  /**
   * @private
   */
  public toString() { return 'Class Wechaty(' + this.setting.puppet + ')'}

  /**
   * Return version of Wechaty
   *
   * @param {boolean} [forceNpm=false]  - if set to true, will only return the version in package.json.
   *                                      otherwise will return git commit hash if .git exists.
   * @returns {string}                  - the version number
   * @example
   *  console.log(Wechaty.instance().version())
   *  // '#git[af39df]'
   *  console.log(Wechaty.instance().version(true))
   *  // '0.7.9'
   */
  public static version(forceNpm = false): string {
    if (!forceNpm) {
      const revision = config.gitVersion()
      if (revision) {
        return `#git[${revision}]`
      }
    }
    return config.npmVersion()
  }

  /**
   * @todo document me
   */
  public version(forceNpm?) {
    return Wechaty.version(forceNpm)
  }

  /**
   * @todo document me
   * @returns {Contact}
   * @deprecated
   */
  public user(): Contact {
    log.warn('Wechaty', 'user() DEPRECATED. use self() instead.')

    if (!this.puppet || !this.puppet.user) {
      throw new Error('no user')
    }
    return this.puppet.user
  }

  /**
   * @private
   */
  public async reset(reason?: string): Promise<void> {
    log.verbose('Wechaty', 'reset() because %s', reason)
    if (!this.puppet) {
      throw new Error('no puppet')
    }
    await this.puppet.reset(reason)
    return
  }

  /**
   * @todo document me
   */
  public async init(): Promise<void> {
    log.info('Wechaty', 'v%s initializing...' , this.version())
    log.verbose('Wechaty', 'puppet: %s'       , this.setting.puppet)
    log.verbose('Wechaty', 'head: %s'         , this.setting.head)
    log.verbose('Wechaty', 'profile: %s'      , this.setting.profile)
    log.verbose('Wechaty', 'uuid: %s'         , this.uuid)

    if (this.state.current() === 'ready') {
      log.error('Wechaty', 'init() already inited. return and do nothing.')
      return
    }

    this.state.target('ready')
    this.state.current('ready', false)

    try {
      await this.initPuppet()
    } catch (e) {
      log.error('Wechaty', 'init() exception: %s', e && e.message)
      Raven.captureException(e)
      throw e
    }

    this.state.current('ready')
    return
  }

  // public on(event: WechatyEventName, listener: Function): this
  /**
   * @listens Wechaty#error
   * @param   {string}    [event='error'] - the `error` event name
   * @param   {Function}  listener        - (error) => void callback function
   * @return  {Wechaty}                   - this for chain
   */
  public on(event: 'error'      , listener: (this: Wechaty, error: Error) => void): this
  /**
   * @todo document me
   */
  public on(event: 'friend'     , listener: (this: Wechaty, friend: Contact, request?: FriendRequest) => void): this
  /**
   * @todo document me
   */
  public on(event: 'heartbeat'  , listener: (this: Wechaty, data: any) => void): this
  /**
   * @todo document me
   */
  public on(event: 'logout'     , listener: (this: Wechaty, user: Contact) => void): this
  /**
   * @todo document me
   */
  public on(event: 'login'      , listener: (this: Wechaty, user: Contact) => void): this
  /**
   * @todo document me
   */
  public on(event: 'message'    , listener: (this: Wechaty, message: Message) => void): this
  /**
   * @todo document me
   */
  public on(event: 'room-join'  , listener: (this: Wechaty, room: Room, inviteeList: Contact[],  inviter: Contact) => void): this
  /**
   * @todo document me
   */
  public on(event: 'room-leave' , listener: (this: Wechaty, room: Room, leaverList: Contact[]) => void): this
  /**
   * @todo document me
   */
  public on(event: 'room-topic' , listener: (this: Wechaty, room: Room, topic: string, oldTopic: string, changer: Contact) => void): this
  /**
   * @todo document me
   */
  public on(event: 'scan'       , listener: (this: Wechaty, url: string, code: number) => void): this
  /**
   * @todo document me
   */
  public on(event: 'EVENT_PARAM_ERROR', listener: () => void): this
  /**
   * @todo document me
   */
  public on(event: WechatyEventName, listener: (...args: any[]) => any): this {
    log.verbose('Wechaty', 'addListener(%s, %s)', event, typeof listener)

    // const thisWithSay: Sayable = {
    //   say: (content: string) => {
    //     return Config.puppetInstance()
    //                   .say(content)
    //   }
    // }

    super.on(event, listener) // `this: Wechaty` is Sayable

    // (...args) => {
    //
    //   return listener.apply(this, args)
    // })

    return this
  }

  /**
   * @todo document me
   * @private
   */
  public async initPuppet(): Promise<Puppet> {
    let puppet: Puppet

    if (!this.setting.head) {
      throw new Error('no head')
    }

    switch (this.setting.puppet) {
      case 'web':
        puppet = new PuppetWeb({
          head:     this.setting.head,
          profile:  this.setting.profile,
        })
        break

      default:
        throw new Error('Puppet unsupport(yet?): ' + this.setting.puppet)
    }

    const eventList: WechatyEventName[] = [
      'error',
      'friend',
      'heartbeat',
      'login',
      'logout',
      'message',
      'room-join',
      'room-leave',
      'room-topic',
      'scan',
    ]

    eventList.map(e => {
      // https://strongloop.com/strongblog/an-introduction-to-javascript-es6-arrow-functions/
      // We’ve lost () around the argument list when there’s just one argument (rest arguments are an exception, eg (...args) => ...)
      puppet.on(e, (...args: any[]) => {
        // this.emit(e, data)
        this.emit.apply(this, [e, ...args])
      })
    })

    // set puppet before init, because we need this.puppet if we quit() before init() finish
    this.puppet = <Puppet>puppet // force to use base class Puppet interface for better encapsolation

    // set puppet instance to Wechaty Static variable, for using by Contact/Room/Message/FriendRequest etc.
    config.puppetInstance(puppet)

    await puppet.init()
    return puppet
  }

  /**
   * @todo document me
   */
  public async quit(): Promise<void> {
    log.verbose('Wechaty', 'quit()')

    if (this.state.current() !== 'ready' || this.state.inprocess()) {
      const err = new Error('quit() must run on a inited instance.')
      log.error('Wechaty', err.message)
      throw err
    }
    this.state.target('standby')
    this.state.current('standby', false)

    if (!this.puppet) {
      log.warn('Wechaty', 'quit() without this.puppet')
      return
    }

    const puppetBeforeDie = this.puppet
    this.puppet     = null
    config.puppetInstance(null)

    await puppetBeforeDie.quit()
                        .catch(e => {
                          log.error('Wechaty', 'quit() exception: %s', e.message)
                          Raven.captureException(e)
                          throw e
                        })
    this.state.current('standby')
    return
  }

  /**
   * @todo document me
   */
  public async logout(): Promise<void>  {
    if (!this.puppet) {
      throw new Error('no puppet')
    }
    await this.puppet.logout()
                    .catch(e => {
                      log.error('Wechaty', 'logout() exception: %s', e.message)
                      Raven.captureException(e)
                      throw e
                    })
    return
  }

  /**
   * get current user
   * @returns {Contact} current logined user
   */
  public self(): Contact {
    if (!this.puppet) {
      throw new Error('Wechaty.self() no puppet')
    }
    return this.puppet.self()
  }

  /**
   * @todo document me
   */
  public async send(message: Message | MediaMessage): Promise<boolean> {
    if (!this.puppet) {
      throw new Error('no puppet')
    }
    return await this.puppet.send(message)
                            .catch(e => {
                              log.error('Wechaty', 'send() exception: %s', e.message)
                              Raven.captureException(e)
                              throw e
                            })
  }

  /**
   * @todo document me
   */
  public async say(content: string): Promise<boolean> {
    log.verbose('Wechaty', 'say(%s)', content)

    if (!this.puppet) {
      throw new Error('no puppet')
    }
    return await this.puppet.say(content)
  }

  /**
   * @todo document me
   * @static
   */
  public static async sleep(millisecond: number): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, millisecond)
    })
  }

  /**
   * @todo document me
   * @private
   */
  public ding() {
    if (!this.puppet) {
      return Promise.reject(new Error('wechaty cant ding coz no puppet'))
    }

    return this.puppet.ding() // should return 'dong'
                      .catch(e => {
                        log.error('Wechaty', 'ding() exception: %s', e.message)
                        Raven.captureException(e)
                        throw e
                      })
  }
}

export default Wechaty
