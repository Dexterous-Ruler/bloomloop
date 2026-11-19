# Running a class with no internet: laptop mode

This guide is for a professor whose classroom has no internet, or internet too
weak for forty phones. Your laptop becomes BloomLoop for the class. The students'
phones join over Wi-Fi from your laptop, either its own hotspot or a small travel
router. Back online, you add each room to your account and it shows in your
reports like any other room.

Nothing here needs a paid service.

---

## 1. What works on the laptop, and what does not

**Works:**
- Rooms, phones joining, questions, answers and marks, the projector view.
- Class questions and votes, attendance, and your records (observations, the wheel,
  hands up, activities).
- Questions you write yourself, and questions made by the offline templates from
  your slides or syllabus text.

**Does not work on the laptop:**
- **Accounts and signing in.** You open the console with the link the laptop prints.
  That link carries the laptop's own teacher key.
- **AI question generation.** It needs the internet. The offline templates and your
  own questions still work.
- **Google Classroom** and the **student Learning Hub**. Both need accounts and the
  internet.

**Kept, and not kept:**
- **Each room** is saved to a file on the laptop's disk. It is saved when the room
  closes, and every minute while it runs (see section 6).
- **Your chapters, questions, classes and rosters on the laptop** live only in the
  laptop's memory. They are gone when the laptop server stops. Set them up after you
  start the server, and do not stop it until the class is over. The room files are
  safe either way.

---

## 2. Hotspot or travel router?

| | Laptop hotspot | Pocket travel router |
|---|---|---|
| Cost | Nothing | A small one-off purchase |
| How many phones | Few. Windows' built-in Mobile Hotspot allows up to 8 devices. | Typically 20 to 50, by the maker's figure |
| Address the phones use | Set by the laptop; can change between classes | You can fix it once (section 4) |
| Setup each class | Turn the hotspot on | Plug the router in |
| Battery | Uses the laptop's | Needs its own power |

These phone counts are typical figures, not ones we have measured. A room sends very
little data, so the number of phones the Wi-Fi accepts is the limit, not speed.

**For a whole class, use a travel router.** A laptop hotspot is fine for a small
group or a trial.

---

## 3. What to buy (travel router)

You need any one of each. No brand is needed; the examples only describe the kind of
thing.

- **A pocket travel router.** These are the small routers sold for hotel rooms, for
  example the palm-sized models powered by USB. Check that it:
  - runs from USB power;
  - lets you choose the Wi-Fi name and password;
  - lets you **reserve an address** for one device. Settings pages call this an
    "address reservation", "static lease" or "DHCP reservation".
- **A USB power bank** to run the router: 10,000 mAh typically runs a small router
  through several lectures. That is a typical figure, not one we have measured.
  Or power the router from a laptop USB port.
- **The laptop's charger.** Keep the laptop plugged in during class.
- Optional: **a network cable**, if both the router and the laptop have a network
  port. A cable connection between the two is steadier than Wi-Fi.

You do not need an internet connection on the router. Leave its "internet" or "WAN"
side empty.

---

## 4. One-time setup

Do this once, with internet, at your desk.

1. **Get BloomLoop onto the laptop.** In the project folder, install everything and
   build the phone pages:

   ```
   npm ci
   npm run build
   ```

   The build is what phones open. Without it the laptop prints a note saying the
   pages are not built, and phones have nothing to load.

2. **The teacher key.** The key is the only thing guarding your console, on a Wi-Fi
   every student has joined, so it must not be a word. Either:
   - leave `TEACHER_KEY` out of `server/.env`: the laptop makes a new random key of
     24 characters at every start, and prints the console link with it (the safer
     choice); or
   - set `TEACHER_KEY` to **16 or more random characters** (from a password manager,
     not a word or a name), if you want the console link to stay the same every class.

   Laptop mode refuses to start with a `TEACHER_KEY` shorter than 16 characters, and
   says why.

3. **Set up the router** (skip for a hotspot):
   - Give its Wi-Fi a name and a **password**. The password keeps people who are
     not in the class off it.
   - Turn off any setting called "AP isolation" or "client isolation". It stops
     phones from reaching the laptop.
   - Connect the laptop to it once, then **reserve an address for the laptop**
     (for example 192.168.8.10). Your join link is then the same every class.

4. **Allow the laptop to be reached.** The first time the laptop server starts,
   your computer may ask whether to let Node.js receive connections. Allow it on
   **private** networks. If phones cannot connect later, see section 9.

5. **Print the join QR code**, once the address is fixed. Make the code for:

   ```
   http://<the laptop's address>:5050/join
   ```

   for example `http://192.168.8.10:5050/join`. The projector view also shows a QR
   code: it uses the address you opened the console on, so open the console with
   the link the laptop prints (section 5), not with `localhost`.

---

## 5. Before class

1. Plug in the laptop and switch off sleep. In the power settings, set "when
   plugged in, never sleep". Closing the lid usually means sleep, so keep it open.
   Check the laptop's date and time are right: with no internet it cannot correct
   its clock, and the room's times (and the date your reports file it under) come
   from it.
2. Turn on the router, or the laptop's hotspot, and connect the laptop to it.
3. Start laptop mode from the project folder:

   ```
   npm --workspace server run laptop
   ```

   (From inside the `server` folder it is `npm run laptop`.)

4. The laptop prints a box that starts `BloomLoop - LAPTOP MODE`. It shows:
   - **Teacher console**: the link to open on this laptop. It contains your
     teacher key. Do not project this window, and do not share the link. **Open the
     console on the laptop itself**, not on a tablet or a second device: the laptop
     serves plain `http://`, and anyone who knows the Wi-Fi password can read what
     travels over it, the key included. The Wi-Fi password does not protect the key.
   - **Students join**: one link for each network the laptop is on. The phones'
     one is the address on the router's or the hotspot's network. If you turn
     the hotspot on after starting, the new address is printed when it appears.
   - **Room archives**: the folder where room files are saved.
   - **Not available here**: the list in section 1.
5. Open the console link. Create the chapter (paste the syllabus text or upload the
   slides), write or approve the questions, create the class and add the roster,
   then open the room.

---

## 6. During class

- Students connect to the Wi-Fi, then scan the QR code or type the join link, then
  the room code.
- Each room is saved to the laptop's disk **every minute** while it runs, and **at
  once when you close it**. If the laptop crashes or the battery dies, you lose at
  most the last minute of that room. Every earlier answer is in its file.
- If the laptop's disk fills up, a save fails and the laptop's window says so. The
  room's file keeps its last complete save. Free some space and the next save
  writes the rest.
- To save more often, start the laptop with `LAPTOP_ARCHIVE_SECONDS` set to the
  number of seconds you want, from 1 to 3600.
- If the laptop restarts mid-class, the room that was running cannot be continued.
  Its file is safe. Set up again and open a new room for the rest of the class.
  Import both files afterwards.
- A very long room can pass 1 MB, the most a room file may hold. If it does, the
  laptop prints a warning. The file is still saved, but it cannot be imported.
  Close that room and open a new one for the rest of the class.
- **Wrong keys.** If one device tries 10 different wrong teacher keys within 10
  minutes, that device is shut out of the console for 10 minutes, even with the right
  key. A console tab still holding the key of an earlier start does not count: it sends
  the same old key each time. If it happens to you, wait ten minutes and open the link
  the laptop printed.
- Only pages served by the laptop itself, at its own addresses and port, may use it.
  A page another device on the Wi-Fi serves is refused, even on the same port.

---

## 7. After class

1. **Close the room** in the console. That saves it at once.
2. **Keep the laptop and its Wi-Fi on for up to 10 minutes more.** A phone that lost
   the connection during class sends the answers it saved when it reconnects. An
   answer to a question the phone was given before the close counts if it reaches the
   laptop within 10 minutes of the close; anything later is kept and marked as not
   counted. These answers go into the room's file at the next save (every minute by
   default) and when you stop the server.
3. **Stop the laptop server** with `Ctrl+C` in its window. It saves every room once
   more before it stops.
4. Find the files. By default they are in `server/.data/laptop-archives/` inside
   the project folder. To use another folder, set `LAPTOP_ARCHIVE_DIR` before
   starting. Each room is one file named after its code, for example
   `room-K7PQ2M-<a long id>.json`.
5. Copy the files somewhere safe that only you can open, such as your own USB drive
   or your own cloud storage. They contain your students' names, roll numbers and
   answers, **and every question's answer key**: keep them away from students, or the
   keys are out for every later class on that chapter. On Linux and macOS the laptop
   writes them readable by your user only; Windows does not apply that setting.

Copy and import the files only after stopping the server. An imported room is never
added to: a copy taken straight after the close misses the answers phones sent in the
minutes after it, and a later copy of the same room is not merged in.

**Once you have internet**, sign in to BloomLoop as usual and import each file.
For each room you choose:
- **the chapter** in your account that its questions belong to;
- **the class** whose roster the attendance was taken against, if the room was
  opened for a class.

Each file becomes a closed room in your account. You see its answers, its
attendance, its class questions and its votes in your reports, attainment and the
marks register, like any room. The import records which laptop session it came
from and when.

BloomLoop keeps an imported room marked as imported. Everything it sends about the room
to staff (the rooms list, the room's pages, the review queue, attainment and the
register) carries a note: BloomLoop checked that the file is a room it can read, not
that it is unchanged since the laptop saved it. Attainment and the register name such
rooms in their method, and can leave imported rooms out. (The console screens that show
this note are still being built.) A phone that
still holds saved answers for an imported room is told the room has been brought
online and takes no more answers.

Safe to repeat:
- **Importing the same file twice changes nothing.** BloomLoop says the room was
  imported already.
- **A later copy of a room you imported is not merged in.** An imported room is
  never changed or added to.

Two limits to know:
- The room's questions were made on the laptop, so they are not in your account's
  question bank. Each answer keeps the question exactly as the student saw it, and
  the reports read it from there. The item statistics list these questions as no
  longer in the bank, since they never were in it.
- An attendance mark for a roll number not on your class's roster in your account
  cannot become a mark. The import lists it, and keeps it in the stored file.

Students marked **under 18** on the roster in your account have no integrity
signals kept, as in every room.

---

## 8. The phones, and saving answers when the Wi-Fi drops

The phone page keeps each answer on the phone until the laptop has it, and sends
it again after a dropout. The phone shows whether an answer is *saved on this
phone*, *sent* or *marked*.

Phones can also take a small **question pack** from the laptop while the Wi-Fi is up:
up to 5 more questions at the student's level and one either side, with no answer
keys. During a dropout the student works through them; the answers are kept on the
phone and marked when it reconnects. Nothing is marked on the phone itself.

One part works differently on a laptop. Browsers only allow a page to keep a copy
of itself for offline use on a secure (https) page, or on the device's own
`localhost`. The laptop serves plain `http://`. So:

- **Still works:** answers are kept on the phone and sent once the laptop is back,
  as long as the page stays open.
- **Does not work:** if a student **reloads the page or reopens the browser while
  the laptop is out of reach**, the browser shows its own "cannot connect" page.
  Once the laptop is back, reloading works, and answers kept on the phone are sent
  then.

Ask students not to reload during a dropout. Wait for the Wi-Fi to come back, then
carry on.

Making the laptop secure (https) would need a certificate installed on every
student's phone, or a web address with a certificate from the internet. Neither is
practical in a classroom, so this guide does not use them.

---

## 9. Troubleshooting

**Phones cannot open the join page**
- Is the phone on the router's or the hotspot's Wi-Fi? Phones often switch to
  mobile data when the Wi-Fi has no internet. Turn mobile data off, or answer
  "stay connected" when the phone asks.
- Is the address right? Compare it with the **Students join** line the laptop
  printed.
- Is the laptop's firewall blocking it? Allow Node.js on private networks. On
  Windows, check that the router's network is set to **Private**, not Public.
- Is "AP isolation" or "client isolation" on in the router? Turn it off.

**The address changed since last class**
- Reserve the laptop's address in the router (section 4).
- With a laptop hotspot, use the address printed today and show the projector's
  QR code instead of a printed one.

**The page opens but is blank, or says the pages are not built**
- Run `npm run build` while you have internet, then start laptop mode again.

**"Teacher key required"**
- Open the console with the link the laptop printed, which carries the key. If you
  set `TEACHER_KEY`, the link is the same every time.

**"Too many wrong teacher keys were tried from this device"**
- Ten different wrong keys came from this device within ten minutes. Wait ten
  minutes, then open the link the laptop printed. If you did not try them, someone
  else on the Wi-Fi may have: restart laptop mode without `TEACHER_KEY` to get a new
  random key.

**Laptop mode will not start: "TEACHER_KEY is ... characters"**
- Remove `TEACHER_KEY` from `server/.env`, or set it to 16 or more random characters
  (section 4).

**Some phones cannot connect when many join**
- The hotspot is full (Windows' limit is 8 devices). Use a travel router.

**The laptop went to sleep**
- Wake it. Phones reconnect by themselves and send the answers they kept. To stop
  it happening again, set "never sleep when plugged in".

**The import says a room with this id or code is already in BloomLoop from
somewhere else**
- A room with the same id is already in BloomLoop (a room online, a deleted room's
  archive, or an import from another account). Nothing was imported or changed, and
  the file stays on your disk.
- A room **code** that is already taken online does not stop an import: the room is
  imported under a new code, and the message says so. The import keeps the laptop's
  code as well.

**The import asks for a chapter or a class**
- Choose the chapter, and the class if it asks, in your account, then import again.
  Nothing was imported the first time.

**The import says the file is over 1 MB**
- A room that long cannot be imported. Keep the file. Next time, close long rooms
  and open a new one partway through.
