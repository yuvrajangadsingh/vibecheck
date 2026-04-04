# vibecheck demo — terminal GIF via VHS
# https://github.com/charmbracelet/vhs
# Regenerate: cd vibecheck && vhs demo.tape

Output demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1000
Set Height 520
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set Padding 20

# Set up env (hidden)
Hide
Type `export PATH="/opt/homebrew/bin:$PATH"`
Enter
Sleep 200ms
Type `export PS1='$ '`
Enter
Sleep 200ms
Type "clear"
Enter
Sleep 200ms
Show

# Run vibecheck using local build (shows as npx in the typed command for README)
Hide
Type `alias vibecheck='node dist/cli.js'`
Enter
Sleep 200ms
Type "clear"
Enter
Sleep 200ms
Show

Type "vibecheck demo-slop.ts"
Enter
Sleep 3s
