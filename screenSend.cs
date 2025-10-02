using System;
using System.Drawing;
using System.Windows.Forms;

namespace ScreenCapture
{
    class DisplayForm : Form
    {
        public CreateForm(short x, short y)
        {
            this.Text = "window";
            this.Width = x;
            this.Height = y;
        }
    }

    class Program
    {
        public static void Main()
        {
            CreateForm NewWindow = new CreateForm(100, 100);
            Application.Run(NewWindow);
        }
    }

    class Send
    {



    }
}