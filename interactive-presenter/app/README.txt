INTERACTIVE PRESENTER - getting started
=======================================

Interactive Presenter shows slides with live content on them: HTML simulations
you can operate during the talk, movies, PDFs and pictures, laid over your slides.
It runs in Google Chrome or Microsoft Edge on Windows, entirely offline. Nothing
is sent anywhere.

This is a test version made by Peter Boggild (DTU Physics). It is shared as it
is, for trying out.


1. INSTALL (once, about 10 seconds)
-----------------------------------
 1. Put this "Interactive Presenter" folder where it can stay, for example in
    Documents. (The installer points Windows at this folder; if you move the
    folder later, run the installer again.)
 2. Double-click  Install Interactive Presenter.cmd
    No administrator rights are needed. It
      - puts an "Interactive Presenter" icon on your desktop,
      - makes .ipe files (presentations) open in Interactive Presenter
        when you double-click them,
      - adds "Import into Interactive Presenter" when you right-click a
        PowerPoint file (Windows 11: under "Show more options"),
      - registers a small helper that the app uses for Windows dialogs
        (choosing a folder, importing PowerPoint).
 3. If Windows shows "Windows protected your PC", click "More info" and then
    "Run anyway". The scripts are plain text files you can read first.

To remove it again: Uninstall Interactive Presenter.cmd (your presentations
are not touched).


2. OPEN THE DEMO
----------------
Double-click  Demo\Demo.ipe

It is a short presentation that shows what the app does: a title page, a figure,
a live HTML simulation, a movie and a PDF. Press the "Present" button (top right)
or F5 to present; the arrow keys or a click move on, Esc goes back to editing.

The first time, the browser may ask "Open Interactive Presenter helper?" when you
use Browse..., Import PowerPoint or Save. Allow it (tick "Always allow" if it is
offered).


3. MAKE YOUR OWN PRESENTATION
-----------------------------
The easiest start is to copy the Demo folder, rename the copy (for example
"My talk"), and open the .ipe file inside it. Then, in the DECK panel (left):
  - change the Title: it is also the file name, and Save asks where to save the
    renamed file;
  - press Save.

The Demo folder shows the layout that keeps a presentation portable:

    My talk\
      My talk.ipe     the presentation itself (one file)
      HTML\           HTML simulations that are LINKED: they load live from here
      Figures\        pictures you put on slides
      PDF\            PDFs you show on slides
      Movies\         movies you play on slides

Pictures, movies and PDFs are COPIED into the .ipe file when you add them, so
those folders are just a tidy place to keep the originals. HTML simulations are
LINKED: the .ipe remembers "HTML\wave-demo.html" and loads it from the folder
next to the .ipe. Copy or move the whole folder together and everything keeps
working, on any PC.

Which folder linked files come from is set in the DECK panel under
"Linked files". The default is the folder of the .ipe file, which the app
learns when you double-click the .ipe or save it. "another folder..." and
Browse... let you pick a different one with a normal Windows folder dialog.
"Check links" lists every linked file and whether it is found.


4. THE MOST USEFUL THINGS
-------------------------
  Add slides        SLIDES panel: import slide pictures (PNG/JPG/SVG, e.g.
                    exported from PowerPoint), or + White / + Title / + Section.
  PowerPoint        DECK panel: Import PowerPoint... (needs PowerPoint on the PC).
                    Text and pictures come in editable, animations as steps.
                    The slides are inserted after the current slide.
  Live content      Draw a box on a slide (edit mode), then choose what goes in
                    it: an HTML file, a movie, a PDF, a picture or text.
  Present           "Present" or F5. Fullscreen: the Fullscreen button.
  Help              The "Help" button opens the manual.


5. SAVING AND BACKUPS
---------------------
Save writes the .ipe file. Autosave is on: every 5 minutes, when something has
changed, it keeps a backup named "<your file>.bak.ipe" inside the browser on
this PC. It survives a browser or PC crash. DECK panel -> Backups... lists the
backups and can open one or save it to disk. (A backup stays on this PC; your
real .ipe file is the one to keep and share.)


6. GOOD TO KNOW
---------------
 - Start the app from the desktop icon or by double-clicking an .ipe file. That
   starts the browser in its own window, with a separate profile, so that the
   app may read the HTML/PDF files next to your presentation. Opening
   InteractivePresenter.html directly also works, but then linked HTML files
   show the copy stored when they were added.
 - The People folder is for portrait pictures used on credit lines; it is empty.
   Name pictures "First Last (Affiliation).png".
 - Questions and suggestions: Peter Boggild, pbog@dtu.dk
