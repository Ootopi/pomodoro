document.body.classList.toggle('preload', false)

const default_alarm = new Audio('./sfx/ding.mp3')

let timer_id = setInterval(tick, 1000)
const db_request = window.indexedDB.open('pomodoro-db')
let db

function blob_to_arraybuffer(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('loadend', _ => resolve(reader.result))
        reader.addEventListener('error', reject)
        reader.readAsArrayBuffer(blob)
    })
}

function arraybuffer_to_blob(buffer, type) { return new Blob([buffer], {type}) }

db_request.addEventListener('error', e => {
    console.log(e)
})

db_request.addEventListener('success', e => {
    db = e.target.result
    init()
})

db_request.addEventListener('upgradeneeded', e => {
    db = e.target.result
    db.createObjectStore('sfx', {keyPath: 'name'})
})

const state = {
    _sessions: [],
    _scheduled_sessions: [],
    _local_session_count: 0,
    _fresh_session: true,
    get fresh_session() { return this._fresh_session },
    set fresh_session(v) { this._fresh_session = v },
    get local_session_count() { return this._local_session_count },
    set local_session_count(v) { this._local_session_count = v },
    get hours() { return this._hours },
    set hours(v) {
        if(v < 0) v = 0
        this._hours = v
        clock_hours.textContent = v.toString().padStart(2, '0')
        clock_hours.classList.toggle('hide', v == 0)
        save_state()
    },
    get minutes() { return this._minutes },
    set minutes(v) {
        if(v < 0) {
            if(this.hours > 0) {
                this.hours --
                v = 59
            } else {
                v = 0
            }
        } else if (v >= 60) {
            this.hours += Math.floor(v / 60)
            v %= 60
        }
        this._minutes = v
        clock_minutes.textContent = v.toString().padStart(2, '0')
        save_state()
    },
    get seconds() { return this._seconds },
    set seconds(v) {
        if(v < 0) {
            if(this.minutes > 0 || this.hours > 0) {
                this.minutes --
                v = 59
            } else {
                v = 0
            }
        } else if(v >= 60) {
            this.minutes += Math.floor(v / 60)
            v %= 60
        }
        this._seconds = v
        clock_seconds.textContent = v.toString().padStart(2, '0')
        save_state()
    },
    get enabled() { return this._enabled },
    set enabled(v) {
        this._enabled = v
        this.fresh_session = false
        btn_start.classList.toggle('start', !v)
        btn_start.classList.toggle('pause', v)
    },
    get session() { return this._session },
    set session(v) {
        this._session = v
        this.enabled = false
        parent.style.backgroundColor = v?.theme.page_background_color ?? 'rgb(30, 30, 30)'
        pomodoro_timer.style.backgroundColor = v?.theme.timer_background_color ?? 'rgb(255, 255, 255, 0.5)'
        this.hours = v?.timing.hours ?? 0
        this.minutes = v?.timing.minutes ?? 0
        this.seconds = v?.timing.seconds ?? 0
        this.sessions.forEach(session => {
            session.dom.classList.toggle('active', session == v)
        })
    },
    get sessions() { return this._sessions },
    get plan() { return this._plan },
    set plan(v) { this._plan = v },
    get scheduled_sessions() { return this._scheduled_sessions }
}

const parent = document.body
const background = create_element('div', 'background')
const pomodoro_timer = create_element('div', 'pomodoro-timer')
const clock = create_element('div', 'clock')
const clock_hours = create_element('span', 'hours')
const clock_minutes = create_element('span', 'minutes')
const clock_seconds = create_element('span', 'seconds')
const btn_start = create_element('button', 'btn-start')
const btn_skip = create_element('button', 'btn-skip')
const clock_bar = create_element('div', 'clock-bar')
const session_bar = create_element('div', 'session-bar')
const schedule = create_element('div', 'schedule')
const btn_reset = create_element('button', 'btn-reset')

const pomodoro_settings = create_element('div', 'pomodoro-settings')
pomodoro_settings.classList.toggle('hide', true)
const pomodoro_settings_sessions_queue = create_element('div', 'sessions-queue')
const pomodoro_settings_sessions = create_element('div', 'sessions')
const pomodoro_settings_btn_add_session = create_element('button', 'btn-add-session')


async function init() {
    init_ui()
    await init_state()
    init_listeners()
}

function tick() {
    if(!state.enabled) return
    state.seconds --
    if(state.hours == 0 && state.minutes == 0 && state.seconds == 0) return times_up()
}

function times_up(skipped = false) {
    if(!skipped) {
        state.session.sfx.load()
        state.session.sfx.play()
    }
    state.enabled = false
    state.local_session_count ++
    
    let count = 0
    let next_schedule

    for(let i = 0; i < state.scheduled_sessions.length; i++) {
        const schedule = state.scheduled_sessions[i]
        count += schedule.times
        if(count > state.local_session_count) {
            next_schedule = schedule
            break
        }
    }

    if(next_schedule == undefined) {
        state.local_session_count = 0
        if(state.scheduled_sessions.length > 0) next_schedule = state.scheduled_sessions[0]
    }

    if(next_schedule != undefined) state.session = next_schedule.session
    state.fresh_session = true
    generate_schedule()
}

function init_ui() {
    clock_bar.appendChild(clock)
    clock_bar.appendChild(btn_start)
    clock_bar.appendChild(btn_skip)

    clock.appendChild(clock_hours)
    clock.appendChild(clock_minutes)
    clock.appendChild(clock_seconds)

    pomodoro_timer.appendChild(session_bar)
    pomodoro_timer.appendChild(clock_bar)
    
    btn_skip.classList.toggle('skip', true)
    
    pomodoro_settings.appendChild(pomodoro_settings_sessions_queue)
    const sessions_queue_label = create_element('span', 'sessions-queue-label')
    sessions_queue_label.textContent = 'schedule'
    pomodoro_settings_sessions_queue.appendChild(sessions_queue_label)
    pomodoro_settings.appendChild(pomodoro_settings_sessions)
    pomodoro_settings.appendChild(pomodoro_settings_btn_add_session)
    pomodoro_settings_btn_add_session.textContent = 'add session'
    pomodoro_settings_btn_add_session.addEventListener('click', add_session_config)
    pomodoro_settings.appendChild(btn_reset)
    btn_reset.textContent = 'factory reset'
    btn_reset.addEventListener('click', _ => {
        if(confirm('Are you sure you want to do a factory reset of the pomodoro timer (all customization will be lost)?')) {
            if(confirm('Are you really really sure you want to do a factory reset of the pomodoro timer (all customization will be lost)?')) {
                localStorage.removeItem('pomodoro-state')
                location.reload()
            }
        }
    })
    

    parent.appendChild(background)
    parent.appendChild(pomodoro_settings)
    parent.appendChild(schedule)
    parent.appendChild(pomodoro_timer)
}

function load_sfx_db(key) {
    return new Promise((resolve, reject) => {
        const sfx_store = db.transaction('sfx', 'readwrite').objectStore('sfx')
        sfx_store.get(key).onsuccess = e => {
            resolve(new Audio(URL.createObjectURL(arraybuffer_to_blob(e.target.result.buffer))))
        }
    })
}

async function init_state() {
    const old_state = load_state()
    if(old_state) {
        state.fresh_session = old_state.fresh_session
        state.local_session_count = old_state.local_session_count

        async function load_sfx(session) {
            const o = {symbol: Symbol(), ... session}
            if(!o.sfx_db) {
                o.sfx = new Audio(session.sfx)
            } else {
                o.sfx = await load_sfx_db(o.sfx_db.name)
            }

            add_session_config(o)
        }

        for(const session of old_state.sessions) await load_sfx(session)

        old_state.scheduled_sessions.forEach(schedule => {
            schedule_session(state.sessions[schedule.session], schedule.times, true)
        })

        state.session = state.sessions[old_state.session]
        state.hours = old_state.hours
        state.minutes = old_state.minutes
        state.seconds = old_state.seconds
        return
    }
    state.hours = 0
    state.minutes = 0
    state.seconds = 0
    state.enabled = false
    const default_sessions = [
        {
            symbol: Symbol(),
            name: 'pomodoro',
            timing: {
                hours: 0,
                minutes: 0,
                seconds: 3
            },
            sfx: default_alarm,
            theme: {
                page_background_color: '#DC5550',
                timer_background_color: 'rgba(255, 255, 255, 0.3)'
            }
        },
        {
            symbol: Symbol(),
            name: 'short break',
            timing: {
                hours: 0,
                minutes: 0,
                seconds: 3
            },
            sfx: default_alarm,
            theme: {
                page_background_color: '#2D9628',
                timer_background_color: 'rgba(255, 255, 255, 0.3)'
            }
        },
        {
            symbol: Symbol(),
            name: 'long break ',
            timing: {
                hours: 0,
                minutes: 0,
                seconds: 3
            },
            sfx: default_alarm,
            theme: {
                page_background_color: '#5550DC',
                timer_background_color: 'rgba(255, 255, 255, 0.3)'
            }
        }
    ]
    
    default_sessions.forEach(x => add_session_config(x))

    schedule_session(state.sessions[0], 1, true)
    schedule_session(state.sessions[1], 1, true)
    schedule_session(state.sessions[0], 1, true)
    schedule_session(state.sessions[1], 1, true)
    schedule_session(state.sessions[0], 1, true)
    schedule_session(state.sessions[1], 1, true)
    schedule_session(state.sessions[0], 1, true)
    schedule_session(state.sessions[2], 1, true)
}

function add_session_config(options) {
    const session = add_session_entry({
        symbol: Symbol(),
        name: '',
        timing: { hours: 0, minutes: 0, seconds: 0 },
        theme: {
            page_background_color: `#${Math.floor(Math.random() * 0xFFFFFF).toString(16)}`,
            timer_background_color: 'rgba(255, 255, 255, 0.3)'
        },
        ... options
    })

    const wrapper = create_element('div', 'session')
    wrapper.addEventListener('mouseover', _ => {
        state.scheduled_sessions
            .filter(x => x.session == session)
            .forEach(x => x.dom.classList.toggle('highlight', true))
    })

    wrapper.addEventListener('mouseout', _ => {
        state.scheduled_sessions
            .filter(x => x.session == session)
            .forEach(x => x.dom.classList.toggle('highlight', false))
    })

    session.config_dom = wrapper

    const btn_delete = document.createElement('button')
    btn_delete.innerHTML = '&#x1F5D9;'
    btn_delete.classList.toggle('btn-delete', true)
    btn_delete.addEventListener('click', e => {
        if(confirm('Are you sure you want to delete this session?')) remove_session_entry(session)
    })

    const input_name = document.createElement('input')
    input_name.type = 'text'
    input_name.placeholder = 'session name'
    input_name.value = session.name
    session.dom.textContent = session.name

    const timing = create_element('div', 'timing')

    const input_hours = create_element('input', 'hours')
    input_hours.type = 'number'
    input_hours.min = 0
    input_hours.value = session.timing.hours
    input_hours.addEventListener('input', _ => {
        session.timing.hours = input_hours.value
        if(state.session == session && state.fresh_session) state.hours = input_hours.value
    })
    
    const input_minutes = create_element('input', 'minutes')
    input_minutes.type = 'number'
    input_minutes.min = 0
    input_minutes.value = session.timing.minutes
    input_minutes.addEventListener('input', _ => {
        session.timing.minutes = input_minutes.value
        if(state.session == session &&  state.fresh_session) state.minutes = input_minutes.value
    })

    const input_seconds = create_element('input', 'seconds')
    input_seconds.type = 'number'
    input_seconds.min = 0
    input_seconds.value = session.timing.seconds
    input_seconds.addEventListener('input', _ => {
        session.timing.seconds = input_seconds.value
        if(state.session == session &&  state.fresh_session) state.seconds = input_seconds.value
    })

    const input_hours_label = create_element('span', 'label')
    input_hours_label.textContent = 'h'
    const input_minutes_label = create_element('span', 'label')
    input_minutes_label.textContent = 'm'
    const input_seconds_label = create_element('span', 'label')
    input_seconds_label.textContent = 's'

    const btn_schedule = create_element('button', 'btn-schedule')
    btn_schedule.innerHTML = '&#x271A;'
    btn_schedule.addEventListener('click', _ => schedule_session(session))

    const theme = create_element('div', 'theme')
    const page_background_color = create_element('input', 'page-background-color')

    page_background_color.type = 'color'
    page_background_color.value = session.theme.page_background_color
    page_background_color.addEventListener('input', _ => {
        session.theme.page_background_color = page_background_color.value
        if(state.session == session) parent.style.backgroundColor = page_background_color.value
    })

    timing.appendChild(input_hours)
    timing.appendChild(input_hours_label)
    timing.appendChild(input_minutes)
    timing.appendChild(input_minutes_label)
    timing.appendChild(input_seconds)
    timing.appendChild(input_seconds_label)

    theme.appendChild(page_background_color)
        
    const btn_upload_sfx = create_element('label', 'btn-upload-sfx')
    const input_upload_sfx = create_element('input', 'input-upload-sfx')
    const sfx_text = document.createTextNode('sfx')
    input_upload_sfx.type = 'file'
    input_upload_sfx.accept = '.mp3, .wav'
    btn_upload_sfx.appendChild(input_upload_sfx)
    btn_upload_sfx.appendChild(sfx_text)

    btn_upload_sfx.addEventListener('mouseover', e => {
        session.sfx.load()
        session.sfx.play()
    })

    btn_upload_sfx.addEventListener('change', e => {
        const file = e.target.files[0]
        if(!file.type.startsWith('audio')) return
        blob_to_arraybuffer(file).then(buffer => {
            const sfx_store = db.transaction('sfx', 'readwrite').objectStore('sfx')
            sfx_store.add({
                'name': file.name,
                'buffer': buffer
            })
            session.sfx_db = { name: file.name }
            session.sfx = new Audio(URL.createObjectURL(file))
            save_state()
        })
    })


    wrapper.appendChild(theme)
    wrapper.appendChild(input_name)
    wrapper.appendChild(btn_delete)
    wrapper.appendChild(timing)
    wrapper.appendChild(btn_schedule)
    wrapper.appendChild(btn_upload_sfx)

    pomodoro_settings_sessions.appendChild(wrapper)

    input_name.addEventListener('input', _ => {
        session.name = input_name.value
        session.dom.textContent = input_name.value
        state.scheduled_sessions.filter(x => x.session == session).forEach(x => x.dom.querySelector('.session').innerText = input_name.value)
        generate_schedule()
    })

    state.sessions.push(session)
}

function init_listeners() {
    document.addEventListener('keyup', e => {
        if(e.key == 'Escape') pomodoro_settings.classList.toggle('hide')
    })

    btn_start.addEventListener('click', _ => state.enabled = !state.enabled)
    btn_skip.addEventListener('click', _ => {
        state.enabled = false
        state.hours = 0
        state.minutes = 0
        state.seconds = 0
        times_up(true)
    })
}

function create_element(type, class_name) {
    const element = document.createElement(type)
    element.classList.toggle(class_name, true)
    return element
}

function add_session_entry(session) {
    const session_entry = create_element('span', 'session')
    session_bar.appendChild(session_entry)
    session.dom = session_entry
    session_entry.addEventListener('click', _ => state.session = session)
    return session
}

function remove_session_entry(session) {
    session.dom.remove()
    session.config_dom.remove()
    const index = state.sessions.indexOf(session)
    state.sessions.splice(index, 1)
    state.scheduled_sessions
        .filter(x => x.session == session)
        .forEach(x => remove_scheduled_entry(x))
    state.local_session_count = 0
    state.session = state.scheduled_sessions.length > 0 ? state.scheduled_sessions[0].session : null
    generate_schedule()
}

function schedule_session(session, times = 1, auto = false) {
    let last_scheduled_session
    if(state.scheduled_sessions.length > 0) last_scheduled_session = state.scheduled_sessions[state.scheduled_sessions.length - 1]
    let is_same_type = session.symbol == last_scheduled_session?.session.symbol
    if(!is_same_type) {
        const schedule_dom = create_element('span', 'schedule')
        schedule_dom.addEventListener('mouseover', _ => {
            session.config_dom.classList.toggle('highlight', true)
            state.scheduled_sessions
                .filter(x => x.session == session)
                .forEach(x => {
                    x.dom.classList.toggle('highlight', true)
                })
        })
        schedule_dom.addEventListener('mouseout', _ => {
            session.config_dom.classList.toggle('highlight', false)
            state.scheduled_sessions
                .filter(x => x.session == session)
                .forEach(x => {
                    x.dom.classList.toggle('highlight', false)
                })
        })
                
        const schedule_times = create_element('input', 'times')
        schedule_times.type = 'number'
        schedule_times.min = 1
        
        const btn_delete = document.createElement('button')
        btn_delete.innerHTML = '&#x1F5D9;'
        btn_delete.classList.toggle('btn-delete', true)
        btn_delete.addEventListener('click', e => {
            if(confirm('Are you sure you want to delete this scheduled session?')) remove_scheduled_entry(schedule)
        })
        
        const schedule = {
            _times: 0,
            session,
            get times() { return this._times },
            set times(v) { 
                this._times = v
                schedule_times.value = v
            },
            dom: schedule_dom
        }

        state.scheduled_sessions.push(schedule)
        if(!auto) schedule_dom.classList.toggle('highlight', true)

        pomodoro_settings_sessions_queue.appendChild(schedule_dom)
        const schedule_session = create_element('span', 'session')
        schedule_session.textContent = session.name
        schedule_dom.appendChild(schedule_session)
        
        schedule.times = times
        schedule_times.addEventListener('input', _ => schedule.times = schedule_times.value)
        schedule_session.textContent = session.name
        schedule_dom.appendChild(schedule_session)
        schedule_dom.appendChild(schedule_times)
        schedule_dom.appendChild(btn_delete)

    } else {
        last_scheduled_session.times ++
    }

    if(!state.session) {
        state.session = session
    }

    generate_schedule()
}

function remove_scheduled_entry(schedule) {
    schedule.dom.remove()
    schedule.session.config_dom.classList.toggle('highlight', false)
    
    state.scheduled_sessions
        .filter(x => x.session == schedule.session)
        .forEach(x => x.dom.classList.toggle('highlight', false))
        
    const index = state.scheduled_sessions.indexOf(schedule)
    if(index < 0) return
    state.scheduled_sessions.splice(index, 1)
    generate_schedule()
}

function generate_schedule() {
    schedule.innerHTML = ''
    let count = 0
    state.scheduled_sessions.forEach(s => {
        for(let i = 0; i < s.times; i++) {
            const el = document.createElement('div')
            el.textContent = s.session.name
            schedule.appendChild(el)
            if(count == state.local_session_count) el.classList.toggle('current', true)
            count ++
        }
    })
    save_state()
}

function load_state() {
    const o = localStorage.getItem('pomodoro-state')
    return JSON.parse(o)
}

function save_state() {
    localStorage.setItem('pomodoro-state', serialize_state())
}

function serialize_state() {
    const { hours, minutes, seconds, local_session_count, scheduled_sessions, session, sessions, fresh_session  } = state
    const o = {
        hours, minutes, seconds, local_session_count, 
        scheduled_sessions: scheduled_sessions.map(seralize_schedule),
        session: sessions.indexOf(session),
        sessions: sessions.map(serialize_session), fresh_session
    }
    return JSON.stringify(o)
}

function seralize_schedule(schedule) {
    if(schedule == null) return null
    const { session, times } = schedule
    return {
        session: state.sessions.indexOf(session),
        times
    }
}

function serialize_session(session) {
    if(session == null) return null
    const {name, timing, theme, sfx, sfx_db } = session
    return { name, timing, theme, sfx: sfx?.src ?? null, sfx_db }
}
